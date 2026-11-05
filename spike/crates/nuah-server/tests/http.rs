use nuah_client::{Http, InProcess, Link};
use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;

/// Start a server on an ephemeral port in its own thread; returns the base URL.
fn spawn_server(core: Core) -> String {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(format!("http://{}", listener.local_addr().unwrap())).unwrap();
            axum::serve(listener, nuah_server::router(core, None)).await.unwrap();
        });
    });
    rx.recv().unwrap()
}

fn token_core() -> Core {
    let mut d = memory_for_tests();
    d.enabled.retain(|e| e != "auth-local" && e != "policy-allow-all");
    d.enabled.extend(["auth-token".to_string(), "policy-roles".to_string()]);
    d.settings.insert("auth-token".into(), json!({"tokens": {
        "t-alice": {"subject":"alice","display":"Alice","roles":["admin"]},
        "t-view": {"subject":"alice","display":"Alice RO","roles":["viewer"]}}}));
    start(d).unwrap()
}

/// One scenario, written once against the Link trait.
fn scenario(link: &dyn Link) -> Value {
    let p = link.call("projects.create", json!({"name": "Home"}), None).unwrap();
    let t = link.call("tasks.create", json!({"project_id": p["id"], "title": "Fix tap", "priority": 8}), Some("k1")).unwrap();
    let again = link.call("tasks.create", json!({"project_id": p["id"], "title": "Fix tap", "priority": 8}), Some("k1")).unwrap();
    assert_eq!(t["id"], again["id"], "idempotent retry returns the first task");
    link.call("tasks.update", json!({"id": t["id"], "status": "Done"}), None).unwrap();
    let c = link.call("comments.add", json!({"task_id": t["id"], "text": "done!"}), None).unwrap();
    let e = link.call("comments.add", json!({"task_id": t["id"], "text": "no", "parent_id": "nope"}), None).unwrap_err();
    json!({
        "tasks": link.call("tasks.list", json!({}), None).unwrap(),
        "comment": c, "error": e,
        "projects": link.call("projects.list", json!({}), None).unwrap(),
        "audit": link.call("audit.list", json!({}), None).unwrap().as_array().unwrap().len(),
    })
}

#[test]
fn coupled_and_decoupled_faces_get_identical_answers() {
    let coupled = InProcess::new(start(memory_for_tests()).unwrap(), None, "test");
    let url = spawn_server(start(memory_for_tests()).unwrap());
    let decoupled = Http::new(&url, None, "test");
    let (a, b) = (scenario(&coupled), scenario(&decoupled));
    assert_eq!(a, b, "same face code, same answers, whichever way it is connected");
    assert_eq!(a["error"]["code"], "not_found");
}

#[test]
fn http_maps_typed_errors_to_status_codes() {
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let post = |op: &str, token: Option<&str>, body: Value| {
        let mut r = agent.post(&format!("{url}/link/call/{op}")).header("X-Nuah-Face", "test");
        if let Some(t) = token { r = r.header("Authorization", &format!("Bearer {t}")); }
        let mut resp = r.send_json(&body).unwrap();
        (resp.status().as_u16(), resp.body_mut().read_json::<Value>().unwrap())
    };
    assert_eq!(post("projects.list", None, json!({})).0, 401);
    assert_eq!(post("projects.list", Some("bad"), json!({})).0, 401);
    let (s, v) = post("projects.create", Some("t-view"), json!({"name": "x"}));
    assert_eq!((s, v["error"]["details"]["missing"].as_str()), (403, Some("tasks.write")));
    assert_eq!(post("nope.nope", Some("t-alice"), json!({})).0, 404);
    assert_eq!(post("projects.create", Some("t-alice"), json!({"name": ""})).0, 400);
    let (s, v) = post("projects.create", Some("t-alice"), json!({"name": "ok"}));
    assert_eq!((s, v["ok"].clone()), (200, json!(true)));
    // malformed JSON body
    let mut resp = agent.post(&format!("{url}/link/call/projects.create")).header("Authorization", "Bearer t-alice")
        .header("Content-Type", "application/json").header("X-Nuah-Face", "test").send("{not json").unwrap();
    assert_eq!(resp.status().as_u16(), 400);
    assert_eq!(resp.body_mut().read_json::<Value>().unwrap()["error"]["code"], "invalid_input");
}

#[test]
fn describe_over_http_carries_the_permission_map() {
    let url = spawn_server(token_core());
    let viewer = Http::new(&url, Some("t-view".into()), "web");
    let d = viewer.describe().unwrap();
    let allowed = |n: &str| d["ops"].as_array().unwrap().iter().find(|o| o["name"] == n).unwrap()["allowed"].clone();
    assert_eq!((allowed("tasks.list"), allowed("tasks.create")), (json!(true), json!(false)));
    assert_eq!(d["slots"][0]["id"], "export");
    let anon = Http::new(&url, None, "web").describe().unwrap();
    assert!(anon["identity"].is_null() && anon["signin"]["kind"] == "token", "an anonymous face learns how to sign in");
}

#[test]
fn pulse_replays_then_streams_and_resumes_without_gaps() {
    let url = spawn_server(token_core());
    let link = Http::new(&url, Some("t-alice".into()), "test");
    let p = link.call("projects.create", json!({"name": "P"}), None).unwrap(); // seq 1
    link.call("tasks.create", json!({"project_id": p["id"], "title": "before watch"}), None).unwrap(); // seq 2

    let (tx, rx) = mpsc::channel();
    let watcher = Http::new(&url, Some("t-alice".into()), "test");
    std::thread::spawn(move || {
        let mut seen = 0;
        watcher.watch(0, &mut |e| { tx.send((e.seq, e.kind)).unwrap(); seen += 1; seen < 4 }).unwrap();
    });
    // live events after the watcher connected
    std::thread::sleep(Duration::from_millis(300));
    link.call("tasks.create", json!({"project_id": p["id"], "title": "live 1"}), None).unwrap(); // 3
    link.call("tasks.create", json!({"project_id": p["id"], "title": "live 2"}), None).unwrap(); // 4
    let got: Vec<(u64, String)> = (0..4).map(|_| rx.recv_timeout(Duration::from_secs(5)).expect("event")).collect();
    assert_eq!(got.iter().map(|g| g.0).collect::<Vec<_>>(), [1, 2, 3, 4], "replayed history then live events, in order");
    assert_eq!(got[0].1, "project.created");

    // a second face resumes from what it last saw
    let (tx, rx) = mpsc::channel();
    let resumer = Http::new(&url, Some("t-alice".into()), "test");
    std::thread::spawn(move || {
        let mut n = 0;
        resumer.watch(2, &mut |e| { tx.send(e.seq).unwrap(); n += 1; n < 2 }).unwrap();
    });
    assert_eq!((0..2).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect::<Vec<_>>(), [3, 4]);
}

#[test]
fn pulse_events_are_private_to_their_owner() {
    let mut d = memory_for_tests();
    d.enabled.retain(|e| e != "auth-local" && e != "policy-allow-all");
    d.enabled.extend(["auth-token".to_string(), "policy-roles".to_string()]);
    d.settings.insert("auth-token".into(), json!({"tokens": {
        "t-a": {"subject":"a","roles":["admin"]}, "t-b": {"subject":"b","roles":["admin"]}}}));
    let url = spawn_server(start(d).unwrap());
    let a = Http::new(&url, Some("t-a".into()), "test");
    let b = Http::new(&url, Some("t-b".into()), "test");
    a.call("projects.create", json!({"name": "secret"}), None).unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { b.watch(0, &mut |e| { tx.send(e.kind).unwrap(); true }).ok(); });
    assert!(rx.recv_timeout(Duration::from_millis(800)).is_err(), "B must not see A's events");
}

#[test]
fn plugin_routes_are_served_with_auth() {
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    assert_eq!(agent.get(&format!("{url}/x/export/madar.json")).call().unwrap().status().as_u16(), 401);
    Http::new(&url, Some("t-alice".into()), "t").call("projects.create", json!({"name": "E"}), None).unwrap();
    let mut r = agent.get(&format!("{url}/x/export/madar.json")).header("Authorization", "Bearer t-alice").call().unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert!(r.headers().get("content-disposition").unwrap().to_str().unwrap().contains("madar-export.json"));
    assert_eq!(r.body_mut().read_json::<Value>().unwrap()["projects"][0]["name"], "E");
    assert_eq!(agent.get(&format!("{url}/x/nothing")).header("Authorization", "Bearer t-alice").call().unwrap().status().as_u16(), 404);
}

#[test]
fn browser_facing_guards() {
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let status = |r: std::result::Result<ureq::http::Response<ureq::Body>, ureq::Error>| r.unwrap().status().as_u16();
    let call = format!("{url}/link/call/projects.list");
    // a cross-site form post: text/plain, no custom header
    assert_eq!(status(agent.post(&call).header("Authorization", "Bearer t-alice").header("Content-Type", "text/plain").send("{}")), 415);
    // JSON but without the face header (cannot be sent cross-site without a preflight)
    assert_eq!(status(agent.post(&call).header("Authorization", "Bearer t-alice").header("Content-Type", "application/json").send("{}")), 400);
    // another origin
    assert_eq!(status(agent.post(&call).header("Authorization", "Bearer t-alice").header("Origin", "http://evil.example").header("Content-Type", "application/json").header("X-Nuah-Face", "x").send("{}")), 403);
    // DNS rebinding: a host name we do not serve
    assert_eq!(status(agent.get(&format!("{url}/healthz")).header("Host", "evil.example").call()), 421);
    // security headers are on every response
    let r = agent.get(&format!("{url}/healthz")).call().unwrap();
    assert!(r.headers().get("content-security-policy").unwrap().to_str().unwrap().contains("frame-ancestors 'none'"));
    assert_eq!(r.headers().get("x-content-type-options").unwrap(), "nosniff");
    // the token is not accepted from the query string on ordinary routes
    assert_eq!(status(agent.get(&format!("{url}/x/export/madar.json?token=t-alice")).call()), 401);
}

#[test]
fn cross_site_requests_to_plugin_routes_are_refused() {
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let r = agent.get(&format!("{url}/x/export/madar.json")).header("Authorization", "Bearer t-alice").header("Sec-Fetch-Site", "cross-site").call().unwrap();
    assert_eq!(r.status().as_u16(), 403);
    let r = agent.get(&format!("{url}/x/export/madar.json")).header("Authorization", "Bearer t-alice").header("Sec-Fetch-Site", "same-origin").call().unwrap();
    assert_eq!(r.status().as_u16(), 200);
}

#[test]
fn generated_documents_need_sign_in_and_cover_what_the_caller_may_do() {
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    for path in ["/link/openapi.json", "/link/tools.json", "/link/client.ts"] {
        let anon = agent.get(&format!("{url}{path}")).call().unwrap();
        assert_eq!(anon.status().as_u16(), 401, "{path} without a token");
    }
    let get = |path: &str, token: &str| agent.get(&format!("{url}{path}")).header("Authorization", &format!("Bearer {token}")).call().unwrap();
    let mut api = get("/link/openapi.json", "t-alice");
    assert_eq!(api.status().as_u16(), 200);
    let api: Value = api.body_mut().read_json().unwrap();
    assert!(api["paths"]["/link/call/tasks.create"]["post"]["requestBody"]["content"]["application/json"]["schema"]["properties"]["title"].is_object());
    assert!(api["paths"]["/link/call/inbox.list"].is_object(), "operations of any installed plugin appear");
    // a viewer's documents leave out what they cannot do
    let mut viewer = get("/link/tools.json", "t-view");
    let tools: Value = viewer.body_mut().read_json().unwrap();
    let names: Vec<&str> = tools.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"tasks_list") && !names.contains(&"tasks_create"), "{names:?}");
    let mut ts = get("/link/client.ts", "t-alice");
    let ts = ts.body_mut().read_to_string().unwrap();
    assert!(ts.contains("tasksCreate(") && ts.contains("class NuahClient"));
}

#[test]
fn undeclared_events_are_refused() {
    struct Chatty;
    impl Plugin for Chatty {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id":"chatty","version":"0.0.1","requires":{"capabilities":["events"]},"contributes":{"ops":["chatty.say"],"events":["chatty.said"]}}).to_string())
        }
        fn activate(&self, a: &mut Activation) -> Result<()> {
            a.op(OpSpec::command("chatty.say", "x.write", "", json!({"type":"object","properties":{"kind":{"type":"string"}}})), |ctx, i, svc| {
                svc.emit(i["kind"].as_str().unwrap_or("chatty.said"), &ctx.subject, json!({}))?;
                Ok(json!(null))
            });
            Ok(())
        }
    }
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Chatty));
    d.enabled.push("chatty".into());
    let core = start(d).unwrap();
    let call = |input: Value| core.call(CallRequest { op: "chatty.say".into(), input, ..Default::default() });
    assert!(call(json!({})).is_ok());
    let e = call(json!({"kind": "chatty.shouted"})).unwrap_err();
    assert!(e.message.contains("does not declare"), "{e}");
    let kinds: Vec<String> = core.describe(None, None)["events"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap().to_string()).collect();
    assert!(kinds.contains(&"chatty.said".to_string()) && kinds.contains(&"task.created".to_string()));
}

#[test]
fn pulse_tickets_are_one_use_and_the_token_is_not_accepted_in_the_url() {
    let status = |r: std::result::Result<ureq::http::Response<ureq::Body>, ureq::Error>| r.unwrap().status().as_u16();
    let url = spawn_server(token_core());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    // no ticket without signing in
    assert_eq!(status(agent.post(&format!("{url}/link/ticket")).header("X-Nuah-Face", "t").send_empty()), 401);
    let mut r = agent.post(&format!("{url}/link/ticket")).header("X-Nuah-Face", "t").header("Authorization", "Bearer t-alice").send_empty().unwrap();
    let ticket = r.body_mut().read_json::<Value>().unwrap()["ticket"].as_str().unwrap().to_string();
    // the old way is gone
    assert_eq!(status(agent.get(&format!("{url}/pulse?token=t-alice")).call()), 401);
    // a made-up ticket is refused
    assert_eq!(status(agent.get(&format!("{url}/pulse?ticket=nope")).call()), 401);
    // the real one opens a stream once, then is spent
    let first = agent.get(&format!("{url}/pulse?ticket={ticket}")).call().unwrap();
    assert_eq!(first.status().as_u16(), 200);
    drop(first);
    assert_eq!(status(agent.get(&format!("{url}/pulse?ticket={ticket}")).call()), 401);
}

// ---------- setup mode ----------

fn spawn_setup(path: std::path::PathBuf) -> String {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(format!("http://{}", listener.local_addr().unwrap())).unwrap();
            let setup = nuah_server::setup::Setup { catalog: catalog(), path, starting_point: memory_for_tests() };
            axum::serve(listener, nuah_server::setup::setup_router(setup, None, nuah_server::default_hosts())).await.unwrap();
        });
    });
    rx.recv().unwrap()
}

#[test]
fn setup_mode_checks_drafts_and_saves_only_what_resolves() {
    let path = std::env::temp_dir().join(format!("nuah-setup-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let base = spawn_setup(path.clone());
    let agent = ureq::Agent::config_builder().http_status_as_error(false).build().new_agent();
    let post = |p: &str, body: Value, face: bool| {
        let mut r = agent.post(&format!("{base}{p}")).header("Content-Type", "application/json");
        if face { r = r.header("X-Nuah-Face", "setup"); }
        let mut res = r.send(body.to_string()).unwrap();
        (res.status().as_u16(), res.body_mut().read_json::<Value>().unwrap_or(Value::Null))
    };

    let mut s = agent.get(&format!("{base}/setup/state")).call().unwrap();
    let state: Value = s.body_mut().read_json().unwrap();
    assert_eq!(state["file_exists"], false);
    assert!(state["plugins"].as_array().unwrap().len() > 10);
    assert_eq!(state["problems"], json!([]));

    let good = nuah_kernel::setup::profile_json(&memory_for_tests());
    let mut bad = good.clone();
    bad["enabled"] = json!(["std", "export"]);

    let (st, body) = post("/setup/check", bad.clone(), true);
    assert_eq!((st, body["ok"].clone()), (200, json!(false)));
    assert!(body["problems"].as_array().unwrap().iter().any(|p| p["code"] == "missing_dependency"));

    let (st, body) = post("/setup/save", bad, true);
    assert_eq!(st, 422);
    assert!(body["problems"].as_array().unwrap().len() >= 2);
    assert!(!path.exists(), "a profile that does not resolve is never written");

    let (st, _) = post("/setup/save", json!({"name": "x", "enabeld": []}), true);
    assert_eq!(st, 422, "unknown keys are rejected");

    let (st, _) = post("/setup/save", good.clone(), false);
    assert_eq!(st, 400, "the face header is required, so a plain cross-site form cannot save");
    assert!(!path.exists());

    let (st, body) = post("/setup/save", good.clone(), true);
    assert_eq!((st, body["ok"].clone()), (200, json!(true)));
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved["enabled"], good["enabled"]);
    // what was saved starts a real core
    start(from_profile_json(&std::fs::read_to_string(&path).unwrap()).unwrap()).unwrap();

    let r = agent.get(&format!("{base}/setup/state")).header("Host", "evil.example").call().unwrap();
    assert_eq!(r.status().as_u16(), 421, "DNS rebinding is refused here too");
    let _ = std::fs::remove_file(&path);
}
