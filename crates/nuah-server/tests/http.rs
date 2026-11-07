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
    start_with(Default::default())
}

fn start_with(cfg: nuah_server::Config) -> Server {
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
            axum::serve(listener, nuah_server::router(core, cfg)).await.unwrap();
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
    fn post(&self, path: &str, body: Value, extra: &[(&str, &str)]) -> Reply {
        let mut req = agent().post(&format!("{}{path}", self.base)).header("Content-Type", "application/json").header("X-Nuah-Face", "test");
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        read(req.send(body.to_string()).unwrap())
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

#[test]
fn faces_are_hosted_revalidated_and_the_root_leads_to_the_first() {
    let dir = std::env::temp_dir().join(format!("nuah-faces-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<title>face</title>").unwrap();
    let cfg = nuah_server::Config { faces: vec![("/faces/web".into(), dir.clone())], ..Default::default() };
    let s = start_with(cfg);
    let page = s.get("/faces/web/", &[]);
    assert_eq!(page.status, 200);
    assert_eq!(page.header("cache-control"), Some("no-cache"), "a Face is revalidated on every load");
    assert!(page.header("content-security-policy").is_some(), "static pages get the same security headers");
    let root = s.get("/", &[]);
    assert_eq!((root.status, root.header("location")), (307, Some("/faces/web/")));
    assert_eq!(s.get("/faces/web/../../etc/passwd", &[]).status, 404);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn failed_sign_ins_are_throttled_per_account_and_a_success_clears_them() {
    let s = start_with(nuah_server::Config { sign_in_failures_per_name: 3, sign_in_failures_overall: 6, ..Default::default() });
    let sign_in = |name: &str, pw: &str| {
        let mut r = agent().post(&format!("{}/link/call/auth.sign_in", s.base)).header("X-Nuah-Face", "t").header("Content-Type", "application/json").send(serde_json::to_vec(&json!({"name": name, "password": pw})).unwrap()).unwrap();
        (r.status().as_u16(), r.headers().get("retry-after").is_some(), r.body_mut().read_json::<Value>().unwrap_or(Value::Null))
    };
    // Two failures, then a success: the count starts over.
    assert_eq!(sign_in("alice", "wrong").0, 401);
    assert_eq!(sign_in("alice", "wrong").0, 401);
    assert_eq!(sign_in("alice", "correct horse").0, 200);
    for _ in 0..3 {
        assert_eq!(sign_in("Alice", "wrong").0, 401);
    }
    // Blocked now, even with the right password, and the case of the name does not matter.
    let (status, retry, body) = sign_in("alice", "correct horse");
    assert_eq!((status, retry), (429, true));
    assert_eq!(body["error"]["key"], "auth.too_many_attempts");
    // Another account is not affected.
    assert_eq!(sign_in("bob", "correct horse").0, 200);
    // Names that do not exist count too. Five failures are on the overall count so far (a success
    // clears one name, not the overall count); one more reaches the limit of six and blocks everyone.
    assert_eq!(sign_in("ghost", "x").0, 401);
    assert_eq!(sign_in("bob", "correct horse").0, 429);
}

#[test]
fn the_web_board_declares_every_slot_madar_fills() {
    // ADR 0016: what plugins put into Slots must be something the board says it can show.
    let decl: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../faces/web/slots.json")).unwrap()).unwrap();
    let core = Core::start(&nuah_madar::distribution(nuah_madar::profile_embedded(":memory:"))).unwrap();
    let me = nuah_kernel::Identity::new("me", "me", &["admin"]);
    let d = core.describe(&me);
    assert!(d["slots"].as_array().unwrap().iter().any(|i| i["id"] == "export.project" && i["slot"] == "project.actions"), "{}", d["slots"]);
    assert_eq!(nuah_kernel::contract::slot_warnings(&d, &decl), Vec::<String>::new());
}

/// Open a Pulse stream and hand back its lines as they arrive.
fn open_stream(s: &Server, token: &str) -> Result<mpsc::Receiver<String>, u16> {
    let res = agent().get(&format!("{}/pulse", s.base)).header("Authorization", &format!("Bearer {token}")).call().unwrap();
    if res.status().as_u16() != 200 {
        return Err(res.status().as_u16());
    }
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
    Ok(rx)
}

fn saw(rx: &mpsc::Receiver<String>, needle: &str) -> bool {
    let end = std::time::Instant::now() + Duration::from_secs(5);
    while let Some(left) = end.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(l) if l.contains(needle) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    false
}

#[test]
fn a_person_holds_a_few_streams_and_the_newest_replaces_the_oldest() {
    let s = start_with(nuah_server::Config { pulse_streams_per_person: 2, ..Default::default() });
    let (ta, tb) = (s.sign_in("alice"), s.sign_in("bob"));
    let first = open_stream(&s, &ta).unwrap();
    assert!(saw(&first, "event: ready"));
    let second = open_stream(&s, &ta).unwrap();
    assert!(saw(&second, "event: ready"));
    // A third takes the place of the oldest, which is told why and then ends.
    let third = open_stream(&s, &ta).unwrap();
    assert!(saw(&third, "event: ready"));
    assert!(saw(&first, "pulse.replaced"), "the oldest stream is closed with a reason");
    // The newer ones still work: a change reaches both.
    let auth = format!("Bearer {ta}");
    s.call("projects.create", json!({"name": "P"}), &[("Authorization", auth.as_str())]);
    assert!(saw(&second, "projects.created") && saw(&third, "projects.created"));
    // Another person's streams are not touched by alice's limit.
    let bob = open_stream(&s, &tb).unwrap();
    assert!(saw(&bob, "event: ready"));
}

#[test]
fn the_server_refuses_new_streams_when_it_is_full_and_frees_places_when_they_end() {
    let s = start_with(nuah_server::Config { pulse_streams_total: 2, ..Default::default() });
    let (ta, tb) = (s.sign_in("alice"), s.sign_in("bob"));
    let a = open_stream(&s, &ta).unwrap();
    let b = open_stream(&s, &tb).unwrap();
    assert!(saw(&a, "event: ready") && saw(&b, "event: ready"));
    assert_eq!(open_stream(&s, &ta).err(), Some(429), "nothing connected is dropped to make room");
    // End bob's stream by signing him out; his place frees up and a new stream is accepted.
    let auth = format!("Bearer {tb}");
    s.call("auth.sign_out", json!({"token": tb}), &[("Authorization", auth.as_str())]);
    assert!(saw(&b, "event: closed"));
    drop(b);
    let end = std::time::Instant::now() + Duration::from_secs(5);
    let again = loop {
        match open_stream(&s, &ta) {
            Ok(rx) => break Some(rx),
            Err(_) if std::time::Instant::now() < end => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break None,
        }
    };
    assert!(again.is_some(), "a place is free again once a stream has ended");
}

#[test]
fn an_uploaded_image_is_served_to_its_owner_as_an_inert_inline_image_and_to_nobody_else() {
    let s = start();
    let (a, b) = (s.sign_in("alice"), s.sign_in("bob"));
    let (ah, bh) = (format!("Bearer {a}"), format!("Bearer {b}"));
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let up = s.call("files.upload", json!({"name": "dot.png", "data": png}), &[("Authorization", &ah)]);
    assert_eq!(up.status, 200, "{:?}", up.body);
    let url = up.body["output"]["url"].as_str().unwrap().to_string();
    // the image itself, with headers that stop it running as a page
    let mut r = agent().get(&format!("{}{url}", s.base)).header("Authorization", &ah).call().unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(r.headers()["content-type"], "image/png");
    assert!(r.headers()["content-disposition"].to_str().unwrap().starts_with("inline"));
    assert!(r.headers()["content-security-policy"].to_str().unwrap().starts_with("sandbox"));
    assert_eq!(r.headers()["x-content-type-options"], "nosniff");
    assert_eq!(r.body_mut().read_to_vec().unwrap().len(), 70);
    // not signed in, or someone else: nothing
    assert_eq!(s.get(&url, &[]).status, 401);
    assert_eq!(s.get(&url, &[("Authorization", &bh)]).status, 404);
    // text is offered as a download, never shown inline
    let txt = s.call("files.upload", json!({"name": "n.txt", "data": "aGVsbG8="}), &[("Authorization", &ah)]);
    let r = agent().get(&format!("{}{}", s.base, txt.body["output"]["url"].as_str().unwrap())).header("Authorization", &ah).call().unwrap();
    assert!(r.headers()["content-disposition"].to_str().unwrap().starts_with("attachment"));
}

/// A tiny site on loopback: `/page` has a preview, `/hop` redirects to it, `/img` is not a page, `/slow` never ends.
fn tiny_site() -> String {
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    std::thread::spawn(move || {
        for s in l.incoming() {
            let Ok(mut s) = s else { continue };
            std::thread::spawn(move || {
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap_or(0);
                let first = String::from_utf8_lossy(&buf[..n]).lines().next().unwrap_or("").to_string();
                let reply = if first.contains("/page") {
                    let body = "<title>Fallback</title><meta property=\"og:title\" content=\"The Big Page\"><meta name=\"description\" content=\"About &amp; things\"><meta property=\"og:image\" content=\"https://img.example/p.png\">";
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
                } else if first.contains("/hop") {
                    "HTTP/1.1 302 Found\r\nLocation: /page\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                } else if first.contains("/img") {
                    "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc".to_string()
                } else {
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                };
                let _ = s.write_all(reply.as_bytes());
            });
        }
    });
    format!("http://{addr}")
}

#[test]
fn link_previews_are_fetched_for_signed_in_people_and_never_from_private_addresses() {
    // set up for the test to reach a loopback site; the same server without the fetcher answers 404
    let site = tiny_site();
    let on = start_with(nuah_server::Config { previews: Some(std::sync::Arc::new(nuah_madar::previews::Fetcher::new(true, 4))), ..Default::default() });
    let a = on.sign_in("alice");
    let ah = format!("Bearer {a}");
    let ask = |url: &str, h: &[(&str, &str)]| on.post("/previews", json!({"url": url}), h);
    assert_eq!(ask(&format!("{site}/page"), &[]).status, 401, "signed in only");
    let r = ask(&format!("{site}/page"), &[("Authorization", &ah)]);
    assert_eq!(r.status, 200, "{:?}", r.body);
    assert_eq!(r.body["output"]["title"], "The Big Page");
    assert_eq!(r.body["output"]["description"], "About & things");
    assert_eq!(r.body["output"]["image"], "https://img.example/p.png");
    assert_eq!(ask(&format!("{site}/hop"), &[("Authorization", &ah)]).body["output"]["title"], "The Big Page", "redirects are followed");
    assert_eq!(ask(&format!("{site}/img"), &[("Authorization", &ah)]).status, 404, "not a page");
    assert_eq!(ask(&format!("{site}/nothing"), &[("Authorization", &ah)]).status, 404);
    assert_eq!(ask("ftp://example.com/x", &[("Authorization", &ah)]).status, 400, "only web addresses");
    // the fourth fetch of the minute is the last (the cached /page does not count)
    let limited = ask(&format!("{site}/other"), &[("Authorization", &ah)]);
    assert_eq!(limited.body["error"]["reason"], "previews.rate_limited", "{:?}", limited.body);

    // the real configuration: loopback and the private network are refused outright
    let real = start_with(nuah_server::Config { previews: Some(std::sync::Arc::new(nuah_madar::previews::Fetcher::new(false, 20))), ..Default::default() });
    let b = real.sign_in("bob");
    let bh = format!("Bearer {b}");
    for bad in [format!("{site}/page"), "http://127.0.0.1/".into(), "http://169.254.169.254/latest/meta-data/".into(), "http://[::1]/".into(), "http://localhost/".into()] {
        assert_eq!(real.post("/previews", json!({"url": bad}), &[("Authorization", &bh)]).status, 400, "{bad}");
    }

    // not set up: nothing is fetched
    let off = start();
    let c = off.sign_in("alice");
    assert_eq!(off.post("/previews", json!({"url": "https://example.com/"}), &[("Authorization", &format!("Bearer {c}"))]).status, 404);
}
