use nuah_adapters::AuthPassword;
use nuah_kernel::Core;
use serde_json::json;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::mpsc;

fn server() -> String {
    let hash = AuthPassword::hash_password("pw");
    let core = Core::start(&nuah_madar::distribution(nuah_madar::profile_server(":memory:", json!([{"name": "alice", "password_hash": hash, "roles": ["member"]}])))).unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(l.local_addr().unwrap()).unwrap();
            nuah_server::spawn_background(core.clone());
            axum::serve(l, nuah_server::router(core, Default::default())).await.unwrap();
        });
    });
    format!("http://{}", rx.recv().unwrap())
}

fn madar(args: &[&str], envs: &[(&str, &str)], stdin: Option<&str>) -> (i32, String, String) {
    let mut c = Command::new(env!("CARGO_BIN_EXE_madar"));
    c.args(args).envs(envs.iter().copied()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let o = child.wait_with_output().unwrap();
    (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stdout).into(), String::from_utf8_lossy(&o.stderr).into())
}

#[test]
fn a_person_can_sign_in_add_a_task_and_see_today_over_http() {
    let url = server();
    let dir = std::env::temp_dir().join(format!("madar-cli-{}", std::process::id()));
    let session = dir.join("session");
    let env = [("MADAR_SERVER", url.as_str()), ("MADAR_SESSION", session.to_str().unwrap())];
    let (code, _, err) = madar(&["projects"], &env, None);
    assert_eq!(code, 3, "not signed in: {err}");
    assert!(err.contains("madar login"));
    let (code, _, err) = madar(&["login", "alice"], &env, Some("wrong\n"));
    assert_eq!(code, 3, "{err}");
    assert!(!session.exists());
    let (code, out, err) = madar(&["login", "alice"], &env, Some("pw\n"));
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("signed in as alice"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&session).unwrap().permissions().mode() & 0o777, 0o600, "the session file is private");
    }
    let (_, out, _) = madar(&["call", "projects.create", "name=Home"], &env, None);
    let id = serde_json::from_str::<serde_json::Value>(&out).unwrap()["id"].as_str().unwrap().to_string();
    let (code, tid, err) = madar(&["add", &id, "Buy", "milk"], &env, None);
    assert_eq!(code, 0, "{err}");
    assert_eq!(tid.trim().len(), 32);
    let (_, out, _) = madar(&["tasks", &id], &env, None);
    assert!(out.contains("TO DO") && out.contains("Buy milk"), "{out}");
    let (code, _, err) = madar(&["call", "tasks.create", &format!("project={id}"), "title=x", "priority=high"], &env, None);
    assert_eq!(code, 2, "wrong type is caught by the CLI before the server: {err}");
    let (code, _, err) = madar(&["call", "projects.get", "project=nope"], &env, None);
    assert_eq!(code, 4, "{err}");
    let (_, out, _) = madar(&["help", "tasks.update"], &env, None);
    assert!(out.contains("expected_rev") && out.contains("tasks.stale_revision"), "{out}");
    let (_, out, _) = madar(&["ops", "labels"], &env, None);
    assert!(out.contains("tasks.labels.create") && !out.contains("projects.create"));
    let (code, out, _) = madar(&["logout"], &env, None);
    assert_eq!((code, out.trim()), (0, "signed out"));
    assert_eq!(madar(&["projects"], &env, None).0, 3, "the session is gone on the server too");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn the_same_commands_work_on_a_database_file_without_a_server() {
    let dir = std::env::temp_dir().join(format!("madar-cli-db-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("m.db");
    let env = [("MADAR_DB", db.to_str().unwrap())];
    let (code, out, err) = madar(&["call", "projects.create", "name=Solo"], &env, None);
    assert_eq!(code, 0, "{err}");
    let id = serde_json::from_str::<serde_json::Value>(&out).unwrap()["id"].as_str().unwrap().to_string();
    madar(&["add", &id, "One"], &env, None);
    let (_, out, _) = madar(&["tasks", &id], &env, None);
    assert!(out.contains("One"), "{out}");
    let (_, out, _) = madar(&["projects"], &env, None);
    assert!(out.contains("Solo"), "the data is in the file, so a second run sees it: {out}");
    std::fs::remove_dir_all(dir).ok();
}
