use nuah_adapters::AuthPassword;
use nuah_kernel::Core;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::time::Duration;

struct Server {
    base: String,
    host: String,
}

fn start() -> Server {
    let hash = AuthPassword::hash_password("correct horse");
    let accounts = json!([
        {"name": "alice", "password_hash": hash, "roles": ["member"]},
        {"name": "bob", "password_hash": hash, "roles": ["member"]},
    ]);
    let core = Core::start(&nuah_madar::distribution(nuah_madar::profile_server(":memory:", accounts))).unwrap_or_else(|p| panic!("{p:#?}"));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap()).unwrap();
            nuah_server::spawn_background(core.clone());
            axum::serve(listener, nuah_server::router(core, Default::default())).await.unwrap();
        });
    });
    let addr = rx.recv().unwrap();
    Server { base: format!("http://{addr}"), host: addr.to_string() }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).build().into()
}

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Value,
}
impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

fn read(mut r: ureq::http::Response<ureq::Body>) -> Reply {
    let status = r.status().as_u16();
    let headers = r.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
    let text = r.body_mut().read_to_string().unwrap_or_default();
    Reply { status, headers, body: serde_json::from_str(&text).unwrap_or(Value::String(text)) }
}

impl Server {
    fn call(&self, op: &str, input: Value, extra: &[(&str, &str)]) -> Reply {
        let mut req = agent().post(&format!("{}/link/call/{op}", self.base)).header("Content-Type", "application/json").header("X-Nuah-Face", "test");
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        read(req.send(input.to_string()).unwrap())
    }
    fn get(&self, path: &str, extra: &[(&str, &str)]) -> Reply {
        let mut req = agent().get(&format!("{}{path}", self.base));
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        read(req.call().unwrap())
    }
    fn sign_in(&self, name: &str) -> String {
        let r = self.call("auth.sign_in", json!({"name": name, "password": "correct horse"}), &[]);
        assert_eq!(r.status, 200, "{:?}", r.body);
        r.body["output"]["token"].as_str().unwrap().to_string()
    }
}

#[test]
fn guards_refuse_what_a_browser_attack_would_send() {
    let s = start();
    let h = s.get("/healthz", &[]);
    assert_eq!((h.status, h.body.clone()), (200, json!({"ok": true})), "liveness says nothing about the data");
    assert_eq!(h.header("x-content-type-options"), Some("nosniff"));
    assert!(h.header("content-security-policy").unwrap().contains("default-src 'self'"));
    assert_eq!(s.get("/healthz", &[("Host", "evil.example")]).status, 421, "DNS rebinding");
    assert_eq!(s.get("/healthz", &[("Origin", "http://evil.example")]).status, 403, "cross-site");
    let own = format!("http://{}", s.host);
    assert_eq!(s.get("/healthz", &[("Origin", &own)]).status, 200);
    let no_face = read(agent().post(&format!("{}/link/call/auth.who", s.base)).header("Content-Type", "application/json").send("{}").unwrap());
    assert_eq!(no_face.status, 400);
    let form = read(agent().post(&format!("{}/link/call/auth.who", s.base)).header("X-Nuah-Face", "t").header("Content-Type", "text/plain").send("{}").unwrap());
    assert_eq!(form.status, 415, "a cross-site form posts text, not JSON");
}

#[test]
fn before_sign_in_only_signing_in_is_visible_and_possible() {
    let s = start();
    let d = s.get("/link/describe", &[]).body;
    assert_eq!(d["operations"].as_object().unwrap().keys().collect::<Vec<_>>(), vec!["auth.sign_in"]);
    let r = s.call("projects.list", json!({}), &[]);
    assert_eq!((r.status, r.body["error"]["category"].clone()), (401, json!("unauthenticated")));
    assert_eq!(s.get("/link/openapi.json", &[]).status, 401, "the contract documents need sign-in");
    let bad = s.call("auth.sign_in", json!({"name": "alice", "password": "wrong"}), &[]);
    assert_eq!((bad.status, bad.body["error"]["reason"].clone()), (401, json!("auth.bad_credentials")));
    let unknown = s.call("nope.nothing", json!({}), &[]);
    assert_eq!(unknown.status, 404);
}

#[test]
fn a_browser_session_lives_in_an_httponly_cookie_the_page_never_sees() {
    let s = start();
    let r = s.call("auth.sign_in", json!({"name": "alice", "password": "correct horse"}), &[("X-Nuah-Session", "cookie")]);
    assert_eq!(r.status, 200);
    assert!(r.body["output"].get("token").is_none(), "the token is not in the body: {:?}", r.body);
    let set = r.header("set-cookie").unwrap().to_string();
    assert!(set.starts_with("nuah_session=") && set.contains("HttpOnly") && set.contains("SameSite=Strict"), "{set}");
    let pair = set.split(';').next().unwrap().to_string();
    let me = s.call("auth.who", json!({}), &[("Cookie", &pair)]);
    assert_eq!(me.body["output"]["subject"], "alice");
    assert_eq!(s.call("projects.create", json!({"name": "Home"}), &[("Cookie", &pair)]).status, 200);
    assert!(s.get("/link/client.ts", &[("Cookie", &pair)]).body.as_str().unwrap().contains("export class NuahClient"));
    // refresh and sign-out work without the Face ever naming its token
    let refreshed = s.call("auth.refresh", json!({}), &[("Cookie", &pair)]);
    assert_eq!(refreshed.status, 200, "{:?}", refreshed.body);
    assert!(refreshed.header("set-cookie").unwrap().contains("Max-Age="));
    let out = s.call("auth.sign_out", json!({}), &[("Cookie", &pair)]);
    assert!(out.header("set-cookie").unwrap().contains("Max-Age=0"));
    assert_eq!(s.call("auth.who", json!({}), &[("Cookie", &pair)]).status, 401, "the session is gone on the server");
}

#[test]
fn bearer_faces_get_idempotency_contract_checks_and_the_generated_documents() {
    let s = start();
    let t = s.sign_in("alice");
    let auth = format!("Bearer {t}");
    let a = [("Authorization", auth.as_str()), ("Idempotency-Key", "k1")];
    let first = s.call("projects.create", json!({"name": "Once"}), &a);
    let again = s.call("projects.create", json!({"name": "Once"}), &a);
    assert_eq!((first.body["replayed"].clone(), again.body["replayed"].clone()), (json!(false), json!(true)));
    assert_eq!(first.body["output"]["id"], again.body["output"]["id"]);
    let clash = s.call("projects.create", json!({"name": "Different"}), &a);
    assert_eq!(clash.status, 409);
    let stale = s.call("projects.list", json!({}), &[("Authorization", auth.as_str()), ("X-Nuah-Contract", "old")]);
    assert_eq!((stale.status, stale.body["error"]["category"].clone()), (426, json!("incompatible")));
    let d = s.get("/link/describe", &[("Authorization", auth.as_str())]).body;
    let hash = d["contract"].as_str().unwrap();
    assert_eq!(s.call("projects.list", json!({}), &[("Authorization", auth.as_str()), ("X-Nuah-Contract", hash)]).status, 200);
    assert!(d["operations"]["tasks.create"]["allowed"].as_bool().unwrap());
    let api = s.get("/link/openapi.json", &[("Authorization", auth.as_str())]).body;
    assert!(api["paths"]["/link/call/tasks.create"].is_object());
    let tools = s.get("/link/tools.json", &[("Authorization", auth.as_str())]).body;
    assert!(tools.as_array().unwrap().iter().any(|t| t["name"] == "tasks_create"));
    let ts = s.get("/link/client.ts", &[("Authorization", auth.as_str())]).body;
    assert!(ts.as_str().unwrap().contains(&format!("export const CONTRACT = \"{hash}\"")));
}

#[test]
fn pulse_streams_only_what_the_person_may_see_and_resumes() {
    let s = start();
    let (ta, tb) = (s.sign_in("alice"), s.sign_in("bob"));
    let stream = |token: &str, after: Option<&str>| {
        let url = format!("{}/pulse{}", s.base, after.map(|a| format!("?after={a}")).unwrap_or_default());
        let res = agent().get(&url).header("Authorization", &format!("Bearer {token}")).call().unwrap();
        assert_eq!(res.status().as_u16(), 200);
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in BufReader::new(res.into_body().into_reader()).lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() {
                            return;
                        }
                    }
                    Err(_) => return,
                }
            }
        });
        rx
    };
    let wait_for = |rx: &mpsc::Receiver<String>, needle: &str| -> Option<String> {
        let end = std::time::Instant::now() + Duration::from_secs(5);
        while let Some(left) = end.checked_duration_since(std::time::Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(l) if l.contains(needle) => return Some(l),
                Ok(_) => {}
                Err(_) => return None,
            }
        }
        None
    };
    let (alice, bob) = (stream(&ta, None), stream(&tb, None));
    assert!(wait_for(&alice, "event: ready").is_some() && wait_for(&bob, "event: ready").is_some());
    let auth_a = format!("Bearer {ta}");
    let p = s.call("projects.create", json!({"name": "Private"}), &[("Authorization", auth_a.as_str())]).body["output"]["id"].as_str().unwrap().to_string();
    let seen = wait_for(&alice, "projects.created").expect("alice hears her own project");
    assert!(seen.contains("event:") || seen.contains("projects.created"));
    // bob is not a member, so he hears nothing; share, and he hears the sharing
    assert!(wait_for(&bob, "projects.created").is_none(), "an outsider hears nothing");
    s.call("projects.share", json!({"project": p, "subject": "bob", "level": "viewer"}), &[("Authorization", auth_a.as_str())]);
    assert!(wait_for(&bob, "projects.").is_some(), "after being shared in, bob hears the project's events");
    // a stream that starts from an old cursor replays what it missed
    let again = stream(&ta, Some("c0"));
    assert!(wait_for(&again, "projects.created").is_some(), "resume from a cursor replays the log");
    // a stream ends when its session does
    let auth_b = format!("Bearer {tb}");
    s.call("auth.sign_out", json!({"token": tb}), &[("Authorization", auth_b.as_str())]);
    s.call("projects.update", json!({"project": p, "name": "Renamed"}), &[("Authorization", auth_a.as_str())]);
    assert!(wait_for(&bob, "event: closed").is_some(), "bob's stream is closed once he signs out");
}

#[test]
fn listeners_run_after_commit_without_anyone_asking() {
    let s = start();
    let t = s.sign_in("alice");
    let auth = format!("Bearer {t}");
    let a = [("Authorization", auth.as_str())];
    let p = s.call("projects.create", json!({"name": "Audited"}), &a).body["output"]["id"].as_str().unwrap().to_string();
    let end = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let list = s.call("audit.list", json!({"project": p}), &a);
        if list.status == 200 && !list.body["output"]["entries"].as_array().map(|e| e.is_empty()).unwrap_or(true) {
            break;
        }
        assert!(std::time::Instant::now() < end, "the audit entry never arrived: {:?}", list.body);
        std::thread::sleep(Duration::from_millis(100));
    }
}
