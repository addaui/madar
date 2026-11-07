//! The `http` plugin as a service (ADR 0031): it starts with the Core, stops with it, frees its port,
//! never hangs on an open Pulse stream, and the host program stops cleanly on SIGTERM.

use madar_server::Madar;
use nuah_adapters::AuthPassword;
use nuah_host::{with_http, HttpFlags, Product};
use nuah_kernel::{Core, Distribution, Services};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn accounts() -> Value {
    json!([{"name": "alice", "password_hash": AuthPassword::hash_password("pw"), "roles": ["member"]}])
}

fn start(port: u16) -> Result<(Core, Services), String> {
    let mut profile = Madar.server_profile(":memory:", accounts());
    with_http(&mut profile, HttpFlags { listen: Some(format!("127.0.0.1:{port}")), hosts: vec![], secure_cookie: false, faces: vec![] });
    let core = Core::start(&Distribution { name: "madar".into(), catalog: Madar.catalog(&[]), profile }).map_err(|p| format!("{p:?}"))?;
    let services = core.start_services().map_err(|e| e.message)?;
    Ok((core, services))
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(5))).build().into()
}

#[test]
fn the_http_plugin_serves_while_the_core_runs_and_frees_its_port_when_it_stops() {
    let port = free_port();
    let (_core, services) = start(port).unwrap();
    assert!(services.running().contains(&"http"));
    let ok = agent().get(&format!("http://127.0.0.1:{port}/healthz")).call().unwrap();
    assert_eq!(ok.status().as_u16(), 200);
    services.stop();
    assert!(agent().get(&format!("http://127.0.0.1:{port}/healthz")).call().is_err(), "the port is closed after stop");
    // and the same port can be taken again
    let (_c, again) = start(port).unwrap();
    again.stop();
}

#[test]
fn a_busy_port_is_a_start_failure_not_a_hang() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let e = start(port).err().expect("must fail");
    assert!(e.contains("cannot listen"), "{e}");
}

#[test]
fn stopping_does_not_wait_for_an_open_pulse_stream() {
    let port = free_port();
    let (_core, services) = start(port).unwrap();
    let base = format!("http://127.0.0.1:{port}");
    let signed = agent()
        .post(&format!("{base}/link/call/auth.sign_in"))
        .header("Content-Type", "application/json")
        .header("X-Nuah-Face", "test")
        .send(json!({"name": "alice", "password": "pw"}).to_string())
        .unwrap()
        .body_mut()
        .read_json::<Value>()
        .unwrap();
    let token = signed["output"]["token"].as_str().unwrap().to_string();
    let stream = ureq::Agent::from(ureq::Agent::config_builder().timeout_global(None).build()).get(&format!("{base}/pulse")).header("Authorization", &format!("Bearer {token}")).call().unwrap();
    assert_eq!(stream.status().as_u16(), 200);
    let t0 = Instant::now();
    services.stop();
    assert!(t0.elapsed() < Duration::from_secs(4), "stop took {:?} with a stream open", t0.elapsed());
    drop(stream);
}

#[cfg(unix)]
#[test]
fn the_host_program_stops_cleanly_on_sigterm() {
    let dir = std::env::temp_dir().join(format!("madar-host-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("accounts.json"), accounts().to_string()).unwrap();
    let port = free_port();
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_madar-server"))
        .args(["serve", "--db", dir.join("m.db").to_str().unwrap(), "--accounts", dir.join("accounts.json").to_str().unwrap(), "--listen", &format!("127.0.0.1:{port}")])
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let up = Instant::now();
    while agent().get(&format!("http://127.0.0.1:{port}/healthz")).call().is_err() {
        assert!(up.elapsed() < Duration::from_secs(10), "the host never came up");
        std::thread::sleep(Duration::from_millis(100));
    }
    std::process::Command::new("kill").args(["-TERM", &child.id().to_string()]).status().unwrap();
    let t0 = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().unwrap() {
            break s;
        }
        assert!(t0.elapsed() < Duration::from_secs(8), "the host ignored SIGTERM");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(status.success(), "{status:?}");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn madar_writes_its_log_to_a_file_and_prometheus_can_scrape_it() {
    let (port, metrics_port) = (free_port(), free_port());
    let dir = std::env::temp_dir().join(format!("madar-telemetry-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("madar.log");
    let mut profile = Madar.server_profile(":memory:", accounts());
    with_http(&mut profile, HttpFlags { listen: Some(format!("127.0.0.1:{port}")), hosts: vec![], secure_cookie: false, faces: vec![] });
    profile.enabled.push("metric-prometheus".into());
    profile.grants.insert("metric-prometheus".into(), vec!["serve".into()]);
    profile.settings.insert("metric-prometheus".into(), json!({"listen": format!("127.0.0.1:{metrics_port}")}));
    let mut catalog = Madar.catalog(&[]);
    nuah_host::with_logging(&mut catalog, &mut profile, Some("debug".into()), Some(log.display().to_string()));
    let core = Core::start(&Distribution { name: "madar".into(), catalog, profile }).unwrap_or_else(|p| panic!("{p:#?}"));
    let services = core.start_services().unwrap();
    let signed = agent()
        .post(&format!("http://127.0.0.1:{port}/link/call/auth.sign_in"))
        .header("Content-Type", "application/json")
        .header("X-Nuah-Face", "test")
        .send(json!({"name": "alice", "password": "pw"}).to_string())
        .unwrap();
    assert_eq!(signed.status().as_u16(), 200);
    let scrape = agent().get(&format!("http://127.0.0.1:{metrics_port}/metrics")).call().unwrap().body_mut().read_to_string().unwrap();
    assert!(scrape.contains("nuah_operations_total{operation=\"auth.sign_in\",outcome=\"ok\"} 1"), "{scrape}");
    services.stop();
    let text = std::fs::read_to_string(&log).unwrap();
    let keys: Vec<String> = text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|v| v["key"].as_str().map(String::from)).collect();
    for want in ["core.started", "http.listening", "metrics.listening", "operation.ok", "core.stopped"] {
        assert!(keys.iter().any(|k| k == want), "the file has no `{want}` record: {keys:?}");
    }
    assert!(!text.contains("\"pw\""), "a password never reaches the log");
    let _ = std::fs::remove_dir_all(&dir);
}
