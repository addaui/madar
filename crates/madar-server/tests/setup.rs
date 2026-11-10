// SPDX-License-Identifier: Apache-2.0
//! The setup wizard's server mode (ADR 0014): code, secrets, save-only-if-it-resolves.

use nuah_adapters::AuthPassword;
use nuah_setup_web::{setup_router, SetupConfig};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc;

const CODE: &str = "abc123def456";

struct Wizard {
    base: String,
    host: String,
    file: PathBuf,
}

fn start(existing: Option<Value>) -> Wizard {
    let dir = std::env::temp_dir().join(format!("nuah-setup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("profile.json");
    if let Some(v) = existing {
        std::fs::write(&file, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    }
    let store = std::sync::Arc::new(nuah_host::edit::ProfileStore::new("madar", madar_server::catalog(), madar_core::profile_embedded("madar.db"), file.clone()));
    let cfg = SetupConfig { store, code: CODE.into(), server: Default::default() };
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(l.local_addr().unwrap()).unwrap();
            axum::serve(l, setup_router(cfg)).await.unwrap();
        });
    });
    let addr = rx.recv().unwrap();
    Wizard { base: format!("http://{addr}"), host: addr.to_string(), file }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).build().into()
}

impl Wizard {
    fn get(&self, path: &str, code: Option<&str>) -> (u16, Value) {
        let mut r = agent().get(&format!("{}{path}", self.base));
        if let Some(c) = code {
            r = r.header("X-Nuah-Setup", c);
        }
        let mut resp = r.call().unwrap();
        (resp.status().as_u16(), resp.body_mut().read_json().unwrap_or(Value::Null))
    }
    fn post(&self, path: &str, body: &Value, code: Option<&str>) -> (u16, Value) {
        let mut r = agent().post(&format!("{}{path}", self.base)).header("X-Nuah-Face", "setup").header("Content-Type", "application/json");
        if let Some(c) = code {
            r = r.header("X-Nuah-Setup", c);
        }
        let mut resp = r.send(serde_json::to_vec(body).unwrap()).unwrap();
        (resp.status().as_u16(), resp.body_mut().read_json().unwrap_or(Value::Null))
    }
}

fn server_profile(hash: &str) -> Value {
    let mut p = serde_json::to_value(madar_core::profile_server("data.db", json!([{"name": "alice", "password_hash": hash, "roles": ["admin"]}]))).unwrap();
    p["name"] = json!("server");
    p
}

#[test]
fn needs_the_setup_code_and_the_usual_guards() {
    let w = start(None);
    assert_eq!(w.get("/setup/state", None).0, 401);
    assert_eq!(w.get("/setup/state", Some("wrong")).0, 401);
    assert_eq!(w.post("/setup/check", &json!({}), None).0, 401);
    assert_eq!(w.get("/setup/state", Some(CODE)).0, 200);
    // The Host allow-list still applies.
    let r = agent().get(&format!("{}/setup/state", w.base)).header("Host", "evil.example").header("X-Nuah-Setup", CODE).call().unwrap();
    assert_eq!(r.status().as_u16(), 421);
    // A POST without the Face header is refused before the code is even looked at.
    let r = agent().post(&format!("{}/setup/check", w.base)).header("Content-Type", "application/json").header("X-Nuah-Setup", CODE).send(b"{}".to_vec()).unwrap();
    assert_eq!(r.status().as_u16(), 400);
    let _ = &w.host;
}

#[test]
fn state_lists_the_catalog_and_never_returns_secrets() {
    let hash = AuthPassword::hash_password("pw");
    let w = start(Some(server_profile(&hash)));
    let (status, body) = w.get("/setup/state", Some(CODE));
    assert_eq!(status, 200);
    assert_eq!(body["problems"], json!([]));
    assert_eq!(body["file_exists"], true);
    assert!(body["plugins"].as_array().unwrap().len() >= 17);
    assert!(body["plugins"].as_array().unwrap().iter().any(|p| p["id"] == "tasks" && p["kind"] == "feature"));
    assert!(!body.to_string().contains(&hash), "the password hash must not leave the server");
    assert_eq!(body["profile"]["settings"]["auth-password"]["accounts"], json!({"$secret": true}));
}

#[test]
fn a_draft_with_the_marker_keeps_the_stored_secret() {
    let hash = AuthPassword::hash_password("pw");
    let w = start(Some(server_profile(&hash)));
    let (_, state) = w.get("/setup/state", Some(CODE));
    let mut draft = state["profile"].clone();
    draft["name"] = json!("renamed");
    let (status, body) = w.post("/setup/check", &draft, Some(CODE));
    assert_eq!((status, &body["problems"]), (200, &json!([])));
    let (status, body) = w.post("/setup/save", &draft, Some(CODE));
    assert_eq!(status, 200, "{body}");
    assert!(!body.to_string().contains(&hash));
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&w.file).unwrap()).unwrap();
    assert_eq!(saved["name"], "renamed");
    assert_eq!(saved["settings"]["auth-password"]["accounts"][0]["password_hash"], hash.as_str());
}

#[test]
fn only_a_profile_that_resolves_is_saved() {
    let w = start(None);
    let before = madar_core::profile_embedded("madar.db");
    let mut draft = serde_json::to_value(&before).unwrap();
    draft["enabled"].as_array_mut().unwrap().push(json!("no-such-plugin"));
    let (status, body) = w.post("/setup/save", &draft, Some(CODE));
    assert_eq!(status, 422);
    assert_eq!(body["problems"][0]["code"], "unknown_plugin");
    assert_eq!(body["problems"][0]["plugins"], json!(["no-such-plugin"]));
    assert!(!w.file.exists(), "nothing is written when there are problems");
    // A typo in a key is an error, not a plugin silently switched off.
    draft["enabeld"] = json!([]);
    assert_eq!(w.post("/setup/save", &draft, Some(CODE)).0, 400);
    assert!(!w.file.exists());
}

#[test]
fn a_saved_profile_starts_a_core_and_is_private() {
    let w = start(None);
    let draft = serde_json::to_value(madar_core::profile_test(&[])).unwrap();
    // The test profile uses plugins the wizard's catalog does not ship (fixed clock): the wizard says so.
    assert_eq!(w.post("/setup/save", &draft, Some(CODE)).0, 422);
    let mut p = serde_json::to_value(madar_core::profile_embedded(":memory:")).unwrap();
    p["name"] = json!("mine");
    let (status, body) = w.post("/setup/save", &p, Some(CODE));
    assert_eq!(status, 200, "{body}");
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&w.file).unwrap()).unwrap();
    let profile = nuah_kernel::setup::profile_from_json(&saved).unwrap();
    nuah_kernel::Core::start(&madar_core::distribution(profile)).unwrap_or_else(|p| panic!("{p:#?}"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&w.file).unwrap().permissions().mode() & 0o777, 0o600);
    }
}

#[test]
fn the_first_administrator_is_asked_for_and_stored_hashed_so_nobody_pastes_a_hash() {
    use nuah_host::Product;
    let w = start(None);
    let mut draft = serde_json::to_value(madar_server::Madar.starting_point(std::path::Path::new("/tmp"))).unwrap();
    draft["settings"]["db-sqlite"]["path"] = json!(":memory:");
    // no account yet: setup says what is missing, and writes nothing
    let (_, checked) = w.post("/setup/check", &draft, Some(CODE));
    assert!(checked["problems"].as_array().unwrap().iter().any(|p| p["code"] == "first_account_missing"), "{checked}");
    assert_eq!(w.post("/setup/save", &draft, Some(CODE)).0, 422);
    draft["first_account"] = json!({"name": "ada", "password": "short"});
    assert_eq!(w.post("/setup/save", &draft, Some(CODE)).0, 422, "a short password is refused");
    draft["first_account"] = json!({"name": "ada", "password": "correct horse"});
    let (status, body) = w.post("/setup/save", &draft, Some(CODE));
    assert_eq!(status, 200, "{body}");
    assert!(!body.to_string().contains("correct horse"));
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&w.file).unwrap()).unwrap();
    assert!(!saved.to_string().contains("correct horse"), "only the hash is stored");
    // and the saved file runs: she signs in, and is an administrator
    let core = nuah_kernel::Core::start(&nuah_kernel::Distribution { name: "madar".into(), catalog: madar_server::catalog(), profile: nuah_kernel::setup::profile_from_json(&saved).unwrap() }).unwrap_or_else(|p| panic!("{p:#?}"));
    let anon = nuah_kernel::Identity::new("", "", &[]);
    let who = core.call_as(&anon, "auth.sign_in", json!({"name": "ada", "password": "correct horse"}), None).unwrap().output["who"].clone();
    assert_eq!(who["roles"], json!(["admin"]));
    // once an account exists, setup does not ask again
    let (_, state) = w.get("/setup/state", Some(CODE));
    let mut again = state["profile"].clone();
    again["name"] = json!("again");
    let (_, checked) = w.post("/setup/check", &again, Some(CODE));
    assert!(!checked["problems"].as_array().unwrap().iter().any(|p| p["code"] == "first_account_missing"), "{checked}");
}
