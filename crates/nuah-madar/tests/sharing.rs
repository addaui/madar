//! Sharing, assignees, board order, archive, and the data migration that introduced them.

use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};
use std::collections::HashMap;

fn dist(path: &str) -> Distribution {
    let mut enabled: Vec<String> = ["std", "adapter-sqlite", "auth-token", "policy-allow-all", "tasks"].iter().map(|s| s.to_string()).collect();
    enabled.sort();
    let tokens: Value = ["alice", "bob", "carol"].iter().map(|n| (format!("t-{n}"), json!({"subject": n, "display": n, "roles": []}))).collect::<serde_json::Map<_, _>>().into();
    Distribution {
        name: "test".into(),
        catalog: catalog(),
        enabled,
        bindings: HashMap::new(),
        settings: HashMap::from([
            ("adapter-sqlite".to_string(), json!({"path": path})),
            ("auth-token".to_string(), json!({"tokens": tokens})),
        ]),
    }
}

fn tmp(name: &str) -> String {
    let p = std::env::temp_dir().join(format!("nuah-{name}-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&p);
    p.to_string_lossy().to_string()
}

fn as_(core: &Core, who: &str, op: &str, input: Value) -> Result<Value> {
    core.call(CallRequest { credential: Some(format!("t-{who}")), op: op.into(), input, ..Default::default() }).map(|r| r.data)
}
fn ok(core: &Core, who: &str, op: &str, input: Value) -> Value {
    as_(core, who, op, input).unwrap_or_else(|e| panic!("{who} {op}: {e}"))
}
fn code(core: &Core, who: &str, op: &str, input: Value) -> String {
    as_(core, who, op, input).expect_err(&format!("{who} {op} should fail")).code
}
fn titles(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|t| t["title"].as_str().unwrap().to_string()).collect()
}

#[test]
fn a_project_is_private_until_shared_and_roles_limit_what_people_can_do() {
    let c = start(dist(":memory:")).unwrap();
    let p = ok(&c, "alice", "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string();
    let t = ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "Pay rent"}))["id"].as_str().unwrap().to_string();

    assert_eq!(ok(&c, "bob", "projects.list", json!({})).as_array().unwrap().len(), 0);
    assert_eq!(code(&c, "bob", "tasks.get", json!({"id": t})), "not_found");
    assert_eq!(code(&c, "bob", "projects.get", json!({"id": p})), "not_found");

    // only the owner shares; the role must be known
    assert_eq!(code(&c, "bob", "projects.share", json!({"id": p, "subject": "bob", "role": "editor"})), "not_found");
    assert_eq!(code(&c, "alice", "projects.share", json!({"id": p, "subject": "bob", "role": "admin"})), "invalid_input");
    assert_eq!(code(&c, "alice", "projects.share", json!({"id": p, "subject": "alice", "role": "viewer"})), "conflict");
    ok(&c, "alice", "projects.share", json!({"id": p, "subject": "bob", "role": "viewer"}));

    // viewer: reads yes, writes no
    assert_eq!(ok(&c, "bob", "projects.list", json!({}))[0]["role"], "viewer");
    assert_eq!(titles(&ok(&c, "bob", "tasks.list", json!({}))), ["Pay rent"]);
    ok(&c, "bob", "comments.list", json!({"task_id": t}));
    assert_eq!(code(&c, "bob", "tasks.create", json!({"project_id": p, "title": "x"})), "permission_denied");
    assert_eq!(code(&c, "bob", "tasks.update", json!({"id": t, "title": "x"})), "permission_denied");
    assert_eq!(code(&c, "bob", "comments.add", json!({"task_id": t, "text": "hi"})), "permission_denied");

    // sharing again changes the role; an editor works but is not the owner
    ok(&c, "alice", "projects.share", json!({"id": p, "subject": "bob", "role": "editor"}));
    let theirs = ok(&c, "bob", "tasks.create", json!({"project_id": p, "title": "Buy milk"}));
    assert_eq!(theirs["owner"], "bob");
    ok(&c, "bob", "comments.add", json!({"task_id": t, "text": "on it"}));
    assert_eq!(code(&c, "bob", "projects.update", json!({"id": p, "name": "Mine"})), "permission_denied");
    assert_eq!(code(&c, "bob", "projects.delete", json!({"id": p})), "permission_denied");
    assert_eq!(code(&c, "bob", "projects.share", json!({"id": p, "subject": "carol", "role": "editor"})), "permission_denied");
    assert_eq!(code(&c, "carol", "tasks.get", json!({"id": t})), "not_found", "a third person still sees nothing");
    assert_eq!(ok(&c, "alice", "projects.members", json!({"id": p})).as_array().unwrap().len(), 2);

    // nobody but the author or owner deletes a comment
    let cm = ok(&c, "bob", "comments.add", json!({"task_id": t, "text": "mine"}))["id"].clone();
    ok(&c, "alice", "projects.share", json!({"id": p, "subject": "carol", "role": "editor"}));
    assert_eq!(code(&c, "carol", "comments.delete", json!({"id": cm})), "permission_denied");
    ok(&c, "alice", "comments.delete", json!({"id": cm}));

    // leaving: a member can remove only themselves; the owner can never be removed
    assert_eq!(code(&c, "bob", "projects.unshare", json!({"id": p, "subject": "carol"})), "permission_denied");
    ok(&c, "bob", "projects.unshare", json!({"id": p, "subject": "bob"}));
    assert_eq!(code(&c, "bob", "tasks.get", json!({"id": t})), "not_found");
    assert_eq!(code(&c, "alice", "projects.unshare", json!({"id": p, "subject": "alice"})), "conflict");
}

#[test]
fn assignees_must_be_members_and_are_freed_when_someone_leaves() {
    let c = start(dist(":memory:")).unwrap();
    let p = ok(&c, "alice", "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string();
    assert_eq!(code(&c, "alice", "tasks.create", json!({"project_id": p, "title": "a", "assignee": "bob"})), "invalid_input");
    ok(&c, "alice", "projects.share", json!({"id": p, "subject": "bob", "role": "editor"}));
    let t = ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "a", "assignee": "bob"}));
    ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "b"}));
    assert_eq!(t["assignee"], "bob");
    assert_eq!(titles(&ok(&c, "bob", "tasks.list", json!({"assignee": "me"}))), ["a"]);
    assert_eq!(titles(&ok(&c, "alice", "tasks.list", json!({"assignee": "bob"}))), ["a"]);
    assert_eq!(code(&c, "alice", "tasks.update", json!({"id": t["id"], "assignee": "carol"})), "invalid_input");
    ok(&c, "alice", "tasks.update", json!({"id": t["id"], "assignee": null}));
    ok(&c, "alice", "tasks.update", json!({"id": t["id"], "assignee": "bob"}));
    ok(&c, "bob", "projects.unshare", json!({"id": p, "subject": "bob"}));
    assert_eq!(ok(&c, "alice", "tasks.get", json!({"id": t["id"]}))["assignee"], Value::Null);
}

#[test]
fn each_member_hears_about_changes_on_their_own_pulse() {
    let c = start(dist(":memory:")).unwrap();
    let p = ok(&c, "alice", "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string();
    let before = c.latest_seq_for("bob");
    ok(&c, "alice", "projects.share", json!({"id": p, "subject": "bob", "role": "viewer"}));
    ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "a"}));
    let kinds: Vec<String> = c.events_since("bob", before, 50).unwrap().iter().map(|e| e.kind.clone()).collect();
    assert_eq!(kinds, ["project.shared", "task.created"]);
    assert!(c.events_since("carol", 0, 50).unwrap().is_empty());
    // the one who left still hears that they were removed
    let mark = c.latest_seq_for("bob");
    ok(&c, "bob", "projects.unshare", json!({"id": p, "subject": "bob"}));
    assert_eq!(c.events_since("bob", mark, 50).unwrap()[0].kind, "project.unshared");
}

#[test]
fn the_board_keeps_the_order_people_give_it() {
    let c = start(dist(":memory:")).unwrap();
    let p = ok(&c, "alice", "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string();
    let mk = |n: &str| ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": n}))["id"].as_str().unwrap().to_string();
    let (a, b, cc) = (mk("A"), mk("B"), mk("C"));
    let order = || titles(&ok(&c, "alice", "tasks.list", json!({"project_id": p, "status": "Backlog"})));
    assert_eq!(order(), ["A", "B", "C"]);
    ok(&c, "alice", "tasks.move", json!({"id": cc}));
    assert_eq!(order(), ["C", "A", "B"]);
    ok(&c, "alice", "tasks.move", json!({"id": cc, "after_id": b}));
    assert_eq!(order(), ["A", "B", "C"]);
    ok(&c, "alice", "tasks.move", json!({"id": a, "after_id": b}));
    assert_eq!(order(), ["B", "A", "C"]);
    assert_eq!(code(&c, "alice", "tasks.move", json!({"id": a, "after_id": "nope"})), "invalid_input");
    assert_eq!(code(&c, "alice", "tasks.move", json!({"id": a, "status": "Nowhere"})), "invalid_input");

    // moving across columns lands where asked and completes the task in the last one
    let done = ok(&c, "alice", "tasks.move", json!({"id": b, "status": "Done"}));
    assert_eq!(done["status"], "Done");
    assert!(done["completed_at"].is_i64());
    assert_eq!(order(), ["A", "C"]);

    // squeezing a task between the same two neighbours again and again must not lose the order
    let extra: Vec<String> = (0..60).map(|i| mk(&format!("X{i}"))).collect();
    for x in &extra {
        ok(&c, "alice", "tasks.move", json!({"id": x, "after_id": a}));
    }
    let got = order();
    let mut want: Vec<String> = vec!["A".into()];
    want.extend((0..60).rev().map(|i| format!("X{i}")));
    want.push("C".into());
    assert_eq!(got, want);
}

#[test]
fn archived_tasks_leave_the_board_but_stay_in_the_project() {
    let c = start(dist(":memory:")).unwrap();
    let p = ok(&c, "alice", "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string();
    let t = ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "Old"}))["id"].clone();
    ok(&c, "alice", "tasks.create", json!({"project_id": p, "title": "New"}));
    ok(&c, "alice", "tasks.update", json!({"id": t, "archived": true}));
    assert_eq!(titles(&ok(&c, "alice", "tasks.list", json!({}))), ["New"]);
    assert_eq!(titles(&ok(&c, "alice", "tasks.list", json!({"archived": true}))), ["Old"]);
    assert_eq!(ok(&c, "alice", "projects.list", json!({}))[0]["task_count"], 1);
    assert_eq!(code(&c, "alice", "tasks.move", json!({"id": t, "status": "Done"})), "conflict");
    assert_eq!(code(&c, "alice", "projects.delete", json!({"id": p})), "conflict");
    ok(&c, "alice", "tasks.update", json!({"id": t, "archived": false}));
    assert_eq!(titles(&ok(&c, "alice", "tasks.list", json!({}))), ["Old", "New"]);
}

#[test]
fn data_from_before_sharing_is_migrated_once_and_a_newer_database_is_refused() {
    let path = tmp("migrate");
    {
        let c = start(dist(&path)).unwrap();
        // write the old shape straight into storage: no memberships, no positions, no version record
        let db = c.ports().db.clone();
        db.put("projects", "p1", &json!({"id":"p1","owner":"alice","name":"Old","statuses":["Todo","Done"],"attributes":{},"created_at":1,"updated_at":1})).unwrap();
        for (i, n) in ["one", "two", "three"].iter().enumerate() {
            db.put("tasks", &format!("t{i}"), &json!({"id":format!("t{i}"),"owner":"alice","project_id":"p1","title":n,"description":"","status":"Todo","priority":0,
                "due":null,"attributes":{},"completed_at":null,"created_at":10+i as i64,"updated_at":1,"version":1})).unwrap();
        }
        db.delete("_meta", "data_version:tasks").unwrap();
        db.delete("memberships", "p1:alice").ok();
    }
    let c = start(dist(&path)).unwrap();
    let list = ok(&c, "alice", "tasks.list", json!({"project_id": "p1"}));
    assert_eq!(titles(&list), ["one", "two", "three"]);
    assert_eq!(list[2]["position"], 3.0);
    assert_eq!(ok(&c, "alice", "projects.list", json!({}))[0]["role"], "owner");
    assert_eq!(code(&c, "bob", "tasks.get", json!({"id": "t0"})), "not_found");
    ok(&c, "alice", "projects.share", json!({"id": "p1", "subject": "bob", "role": "viewer"}));
    drop(c);

    // a second start does not run it again (the viewer is still there, nothing is rewritten)
    let c = start(dist(&path)).unwrap();
    assert_eq!(ok(&c, "alice", "projects.members", json!({"id": "p1"})).as_array().unwrap().len(), 2);
    c.ports().db.put("_meta", "data_version:tasks", &json!({"id": "data_version:tasks", "version": 99})).unwrap();
    drop(c);
    let msg = match start(dist(&path)) { Ok(_) => panic!("should refuse"), Err(p) => p };
    assert!(msg.contains("newer than this plugin"), "{msg}");
    let _ = std::fs::remove_file(&path);
}
