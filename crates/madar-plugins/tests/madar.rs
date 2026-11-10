// SPDX-License-Identifier: Apache-2.0
use nuah_adapters::*;
use nuah_kernel::*;
use madar_plugins::*;
use serde_json::{json, Value};
use std::sync::Arc;

struct App {
    core: Core,
    clock: Arc<FixedClock>,
}

fn app_on(db: &str) -> App {
    let clock = FixedClock::at(1_700_000_000_000); // 2023-11-14
    let mut p = profile_test(&[("quota", json!({"max_tasks": 50}))]);
    if db == "sqlite" {
        p.enabled.retain(|e| e != "@nuah/db-memory");
        p.enabled.push("db-sqlite".into());
        p.settings.insert("db-sqlite".into(), json!({"path": ":memory:"}));
    }
    let dist = distribution_with(p, vec![Arc::new(TestClock(clock.clone())), Arc::new(TestIds)]);
    let core = Core::start(&dist).unwrap_or_else(|p| panic!("{p:#?}"));
    App { core, clock }
}
fn app() -> App {
    app_on("memory")
}

fn who(name: &str) -> Identity {
    Identity::new(name, name, &["member"])
}
fn viewer(name: &str) -> Identity {
    Identity::new(name, name, &["viewer"])
}

impl App {
    fn call(&self, who: &Identity, op: &str, input: Value) -> Result<Value> {
        self.core.call_as(who, op, input, None).map(|r| r.output)
    }
    fn ok(&self, who: &Identity, op: &str, input: Value) -> Value {
        self.call(who, op, input.clone()).unwrap_or_else(|e| panic!("{op} {input} failed: {e}"))
    }
    fn err(&self, who: &Identity, op: &str, input: Value) -> Error {
        self.call(who, op, input).expect_err("expected a failure")
    }
    fn project(&self, who: &Identity, name: &str) -> String {
        self.ok(who, "projects.create", json!({"name": name}))["id"].as_str().unwrap().to_string()
    }
    fn task(&self, who: &Identity, p: &str, title: &str) -> Value {
        self.ok(who, "tasks.create", json!({"project": p, "title": title}))
    }
    fn titles(&self, who: &Identity, p: &str, status: &str) -> Vec<String> {
        self.ok(who, "tasks.list", json!({"project": p, "status": status}))["tasks"].as_array().unwrap().iter().map(|t| t["title"].as_str().unwrap().to_string()).collect()
    }
    fn settle(&self) {
        // listeners run after commit; drain until quiet (they may cause more events)
        for _ in 0..5 {
            if self.core.drain_listeners().unwrap() == 0 {
                break;
            }
        }
    }
}

#[test]
fn a_new_project_has_columns_and_you_own_it() {
    let a = app();
    let al = who("alice");
    let p = a.ok(&al, "projects.create", json!({"name": "Home"}));
    assert_eq!(p["level"], "owner");
    assert_eq!(p["statuses"].as_array().unwrap().len(), 3);
    assert_eq!(p["can"], json!(["projects.read", "projects.write", "projects.manage"]));
    assert_eq!(a.ok(&al, "projects.list", json!({}))["projects"].as_array().unwrap().len(), 1);
    assert_eq!(a.err(&al, "projects.create", json!({"name": "x", "statuses": [{"id": "a", "name": "A"}]})).category, Category::Invalid, "at least two columns");
    assert_eq!(a.err(&al, "projects.create", json!({"name": "x", "statuses": [{"id": "a", "name": "A"}, {"id": "a", "name": "B"}]})).category, Category::Invalid, "ids are unique");
}

#[test]
fn access_is_answered_by_the_core_not_the_face() {
    let a = app();
    let (al, bo, ca, vi) = (who("alice"), who("bob"), who("carol"), viewer("vic"));
    let p = a.project(&al, "Home");
    let t = a.task(&al, &p, "Fix tap");
    // a stranger cannot tell the project exists
    assert_eq!(a.err(&bo, "tasks.list", json!({"project": p})).category, Category::NotFound);
    assert_eq!(a.err(&bo, "projects.get", json!({"project": p})).category, Category::NotFound);
    assert!(a.ok(&bo, "projects.list", json!({}))["projects"].as_array().unwrap().is_empty());
    // viewer level: reads, cannot write; the result says so
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "viewer"}));
    let got = a.ok(&bo, "tasks.get", json!({"project": p, "id": t["id"]}));
    assert_eq!(got["can"], json!(["projects.read"]));
    assert_eq!(a.err(&bo, "tasks.update", json!({"project": p, "id": t["id"], "title": "x"})).category, Category::Denied);
    // editor level: writes, cannot manage
    a.ok(&al, "projects.share", json!({"project": p, "subject": "carol", "level": "editor"}));
    a.ok(&ca, "tasks.update", json!({"project": p, "id": t["id"], "title": "Fix the tap"}));
    assert_eq!(a.err(&ca, "projects.update", json!({"project": p, "name": "Mine"})).category, Category::Denied);
    assert_eq!(a.err(&ca, "projects.share", json!({"project": p, "subject": "dave", "level": "viewer"})).category, Category::Denied);
    // an instance-wide viewer Role cannot write even as an editor of the project
    a.ok(&al, "projects.share", json!({"project": p, "subject": "vic", "level": "editor"}));
    assert_eq!(a.err(&vi, "tasks.update", json!({"project": p, "id": t["id"], "title": "y"})).category, Category::Denied);
    assert!(a.call(&vi, "tasks.get", json!({"project": p, "id": t["id"]})).is_ok());
    // a task id from another project is not found
    let q = a.project(&al, "Work");
    assert_eq!(a.err(&al, "tasks.get", json!({"project": q, "id": t["id"]})).category, Category::NotFound);
}

#[test]
fn the_owner_cannot_be_removed_and_anyone_can_leave() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    assert_eq!(a.err(&al, "projects.unshare", json!({"project": p, "subject": "alice"})).reason.as_deref(), Some("projects.owner_fixed"));
    assert_eq!(a.err(&al, "projects.share", json!({"project": p, "subject": "alice", "level": "viewer"})).reason.as_deref(), Some("projects.owner_fixed"));
    assert_eq!(a.err(&al, "projects.leave", json!({"project": p})).reason.as_deref(), Some("projects.owner_fixed"));
    a.ok(&bo, "projects.leave", json!({"project": p}));
    assert_eq!(a.err(&bo, "tasks.list", json!({"project": p})).category, Category::NotFound);
}

#[test]
fn tasks_have_a_board_order_and_moves_keep_it() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let t: Vec<Value> = ["a", "b", "c"].iter().map(|n| a.task(&al, &p, n)).collect();
    assert_eq!(a.titles(&al, &p, "todo"), ["a", "b", "c"]);
    // c to the top, then a after b in another column
    a.ok(&al, "tasks.move", json!({"project": p, "id": t[2]["id"]}));
    assert_eq!(a.titles(&al, &p, "todo"), ["c", "a", "b"]);
    a.ok(&al, "tasks.move", json!({"project": p, "id": t[0]["id"], "status": "doing"}));
    assert_eq!(a.titles(&al, &p, "doing"), ["a"]);
    a.ok(&al, "tasks.move", json!({"project": p, "id": t[1]["id"], "status": "doing", "after": t[0]["id"]}));
    assert_eq!(a.titles(&al, &p, "doing"), ["a", "b"]);
    // many moves to the same spot squeeze the gap; the column is renumbered and order survives
    for _ in 0..60 {
        a.ok(&al, "tasks.move", json!({"project": p, "id": t[1]["id"], "status": "doing", "after": t[0]["id"]}));
        a.ok(&al, "tasks.move", json!({"project": p, "id": t[2]["id"], "status": "doing", "after": t[0]["id"]}));
    }
    assert_eq!(a.titles(&al, &p, "doing"), ["a", "c", "b"]);
    assert_eq!(a.err(&al, "tasks.move", json!({"project": p, "id": t[0]["id"], "status": "nope"})).reason.as_deref(), Some("tasks.bad_status"));
    assert_eq!(a.err(&al, "tasks.move", json!({"project": p, "id": t[0]["id"], "after": "ghost"})).category, Category::NotFound);
}

#[test]
fn finishing_sets_the_completion_time_and_reopening_clears_it() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let t = a.task(&al, &p, "x");
    assert!(t["completed_at"].is_null());
    let done = a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "status": "done"}));
    assert_eq!(done["completed_at"], 1_700_000_000_000i64);
    let back = a.ok(&al, "tasks.move", json!({"project": p, "id": t["id"], "status": "todo"}));
    assert!(back["completed_at"].is_null());
    let again = a.ok(&al, "tasks.move", json!({"project": p, "id": t["id"], "status": "done"}));
    assert!(!again["completed_at"].is_null());
}

#[test]
fn editing_a_stale_copy_is_a_conflict_with_the_tasks_own_reason() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let t = a.task(&al, &p, "x");
    let first = a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "title": "y", "expected_rev": t["rev"]}));
    assert!(first["rev"].as_u64() > t["rev"].as_u64());
    let e = a.err(&al, "tasks.update", json!({"project": p, "id": t["id"], "title": "z", "expected_rev": t["rev"]}));
    assert_eq!((e.category, e.reason.as_deref()), (Category::Conflict, Some("tasks.stale_revision")));
}

#[test]
fn subtasks_are_one_level_and_go_with_their_parent() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let parent = a.task(&al, &p, "parent");
    let sub = a.ok(&al, "tasks.create", json!({"project": p, "title": "sub", "parent": parent["id"]}));
    assert_eq!(a.err(&al, "tasks.create", json!({"project": p, "title": "deep", "parent": sub["id"]})).reason.as_deref(), Some("tasks.bad_parent"));
    assert_eq!(a.err(&al, "tasks.create", json!({"project": p, "title": "ghost", "parent": "nope"})).reason.as_deref(), Some("tasks.bad_parent"));
    assert_eq!(a.titles(&al, &p, "todo"), ["parent", "sub"].iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter().filter(|_| true).collect::<Vec<_>>());
    a.ok(&al, "discussion.add", json!({"project": p, "task": sub["id"], "body": "note on sub"}));
    a.ok(&al, "tasks.remove", json!({"project": p, "id": parent["id"]}));
    assert!(a.ok(&al, "tasks.list", json!({"project": p}))["tasks"].as_array().unwrap().is_empty());
    a.settle();
    // the comment on the removed subtask is cleaned up after the commit
    let rec = a.ok(&al, "export.project", json!({"project": p}));
    assert!(rec["comments"].as_array().unwrap().is_empty());
}

#[test]
fn assignees_must_be_members_and_leaving_clears_the_assignment() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    let e = a.err(&al, "tasks.create", json!({"project": p, "title": "x", "assignee": "bob"}));
    assert_eq!(e.reason.as_deref(), Some("tasks.assignee_not_member"));
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "x", "assignee": "bob"}));
    assert_eq!(t["assignee"], "bob");
    a.ok(&bo, "projects.leave", json!({"project": p}));
    a.settle();
    assert!(a.ok(&al, "tasks.get", json!({"project": p, "id": t["id"]}))["assignee"].is_null());
}

#[test]
fn today_gathers_what_is_assigned_to_you_across_projects() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let (p, q) = (a.project(&al, "Home"), a.project(&bo, "Work"));
    a.ok(&bo, "projects.share", json!({"project": q, "subject": "alice", "level": "editor"}));
    a.ok(&al, "tasks.create", json!({"project": p, "title": "late", "assignee": "alice", "due": "2023-11-10"}));
    a.ok(&al, "tasks.create", json!({"project": p, "title": "now", "assignee": "alice", "due": "2023-11-14", "priority": 9}));
    a.ok(&bo, "tasks.create", json!({"project": q, "title": "soon", "assignee": "alice", "due": "2023-12-01"}));
    a.ok(&bo, "tasks.create", json!({"project": q, "title": "someday", "assignee": "alice"}));
    a.ok(&bo, "tasks.create", json!({"project": q, "title": "not mine", "assignee": "bob"}));
    let done = a.ok(&al, "tasks.create", json!({"project": p, "title": "finished", "assignee": "alice", "status": "done"}));
    let my = a.ok(&al, "tasks.my", json!({}));
    assert_eq!(my["today"], "2023-11-14");
    let rows: Vec<(String, String)> = my["tasks"].as_array().unwrap().iter().map(|t| (t["title"].as_str().unwrap().into(), t["bucket"].as_str().unwrap().into())).collect();
    assert_eq!(rows, [("late", "overdue"), ("now", "today"), ("soon", "upcoming"), ("someday", "undated")].map(|(a, b)| (a.to_string(), b.to_string())));
    assert!(my["tasks"].as_array().unwrap().iter().all(|t| t["id"] != done["id"]), "finished tasks are not on Today");
    assert_eq!(my["tasks"][2]["project_name"], "Work");
    assert!(my["tasks"][0]["can"].as_array().unwrap().contains(&json!("projects.write")));
}

#[test]
fn labels_filter_and_removing_one_strips_it_from_tasks() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let l = a.ok(&al, "tasks.labels.create", json!({"project": p, "name": "urgent", "color": "red"}));
    assert_eq!(a.err(&al, "tasks.labels.create", json!({"project": p, "name": "urgent"})).reason.as_deref(), Some("tasks.label_exists"));
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "tagged", "labels": [l["id"]]}));
    a.task(&al, &p, "plain");
    let q = a.project(&al, "Other");
    assert_eq!(a.err(&al, "tasks.create", json!({"project": q, "title": "x", "labels": [l["id"]]})).reason.as_deref(), Some("tasks.unknown_label"));
    let by = a.ok(&al, "tasks.list", json!({"project": p, "label": l["id"]}));
    assert_eq!(by["tasks"].as_array().unwrap().len(), 1);
    a.ok(&al, "tasks.labels.remove", json!({"project": p, "id": l["id"]}));
    assert_eq!(a.ok(&al, "tasks.get", json!({"project": p, "id": t["id"]}))["labels"], json!([]));
    assert!(a.ok(&al, "tasks.labels.list", json!({"project": p}))["labels"].as_array().unwrap().is_empty());
}

#[test]
fn a_column_that_holds_tasks_cannot_be_removed() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    a.task(&al, &p, "x");
    let cols = json!([{"id": "todo", "name": "Todo"}, {"id": "done", "name": "Done"}]);
    // "doing" is empty, so it can go; "todo" is in use
    a.ok(&al, "projects.update", json!({"project": p, "statuses": cols}));
    let e = a.err(&al, "projects.update", json!({"project": p, "statuses": [{"id": "a", "name": "A"}, {"id": "done", "name": "Done"}]}));
    assert_eq!(e.reason.as_deref(), Some("tasks.status_in_use"));
    assert_eq!(e.params["status"], "todo");
}

#[test]
fn the_quota_is_a_hook_the_task_plugin_knows_nothing_about() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    for n in 0..50 {
        a.task(&al, &p, &format!("t{n}"));
    }
    let e = a.err(&al, "tasks.create", json!({"project": p, "title": "one too many"}));
    assert_eq!(e.reason.as_deref(), Some("quota.exceeded"));
    assert_eq!(e.params["max"], 50);
    let q = a.project(&al, "Other");
    a.task(&al, &q, "fine");
}

#[test]
fn comments_replies_and_who_may_remove_them() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.task(&al, &p, "x");
    let c = a.ok(&bo, "discussion.add", json!({"project": p, "task": t["id"], "body": "hello"}));
    let r = a.ok(&al, "discussion.add", json!({"project": p, "task": t["id"], "body": "hi", "parent": c["id"]}));
    assert_eq!(a.err(&al, "discussion.add", json!({"project": p, "task": t["id"], "body": "deep", "parent": r["id"]})).reason.as_deref(), Some("discussion.bad_parent"));
    let list = a.ok(&bo, "discussion.list", json!({"project": p, "task": t["id"]}));
    assert_eq!(list["comments"].as_array().unwrap().len(), 2);
    assert_eq!(list["comments"][0]["can_remove"], true, "bob wrote it");
    assert_eq!(list["comments"][1]["can_remove"], false, "bob did not write the reply, and is not the owner");
    assert_eq!(a.err(&bo, "discussion.remove", json!({"project": p, "id": r["id"]})).reason.as_deref(), Some("discussion.not_yours"));
    a.ok(&al, "discussion.remove", json!({"project": p, "id": c["id"]})); // the owner may; the reply goes too
    assert!(a.ok(&al, "discussion.list", json!({"project": p, "task": t["id"]}))["comments"].as_array().unwrap().is_empty());
}

#[test]
fn only_owners_read_the_audit_and_it_records_what_happened() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.task(&bo, &p, "x");
    a.ok(&bo, "tasks.update", json!({"project": p, "id": t["id"], "priority": 8}));
    a.settle();
    assert_eq!(a.err(&bo, "audit.list", json!({"project": p})).category, Category::Denied);
    let entries = a.ok(&al, "audit.list", json!({"project": p}));
    let kinds: Vec<&str> = entries["entries"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap()).collect();
    for k in ["projects.created", "projects.shared", "tasks.created", "tasks.updated"] {
        assert!(kinds.contains(&k), "{k} missing from {kinds:?}");
    }
    let upd = entries["entries"].as_array().unwrap().iter().find(|e| e["kind"] == "tasks.updated").unwrap();
    assert_eq!(upd["actor"], "bob");
    assert_eq!(upd["data"]["changes"]["priority"], json!([0, 8]));
    // delivering twice records once
    let n = kinds.len();
    a.settle();
    assert_eq!(a.ok(&al, "audit.list", json!({"project": p}))["entries"].as_array().unwrap().len(), n);
}

#[test]
fn people_hear_about_assignments_and_finished_work() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "Fix the tap", "assignee": "bob"}));
    a.settle();
    let inbox = a.ok(&bo, "inbox.list", json!({}));
    assert_eq!(inbox["unread"], 1);
    assert!(inbox["messages"][0]["text"].as_str().unwrap().contains("alice assigned you: Fix the tap"));
    assert_eq!(inbox["messages"][0]["link"]["project"], p.as_str());
    // assigning to yourself says nothing; finishing tells the creator
    a.ok(&bo, "tasks.update", json!({"project": p, "id": t["id"], "status": "done"}));
    a.settle();
    assert_eq!(a.ok(&al, "inbox.list", json!({}))["messages"][0]["text"], "bob finished: Fix the tap");
    assert!(a.ok(&bo, "inbox.list", json!({"unread": true}))["messages"].as_array().unwrap().len() == 1);
    a.ok(&bo, "inbox.read", json!({}));
    assert_eq!(a.ok(&bo, "inbox.list", json!({}))["unread"], 0);
    assert_eq!(a.ok(&al, "inbox.list", json!({}))["messages"].as_array().unwrap().len(), 1, "inboxes are private");
}

#[test]
fn live_changes_reach_members_and_stop_reaching_someone_who_left() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let (ca, cb) = (a.core.pulse_now().unwrap(), a.core.pulse_now().unwrap());
    a.task(&al, &p, "one");
    let kinds = |who: &Identity, c: &str| a.core.pulse(who, Some(c), 100).unwrap().events.iter().map(|e| e.kind.clone()).collect::<Vec<_>>();
    assert_eq!(kinds(&bo, &cb), ["tasks.created"]);
    assert_eq!(kinds(&al, &ca), ["tasks.created"]);
    a.ok(&al, "projects.unshare", json!({"project": p, "subject": "bob"}));
    let cb2 = a.core.pulse_now().unwrap();
    a.task(&al, &p, "two");
    assert!(kinds(&bo, &cb2).is_empty(), "bob left, so he hears nothing more from this project");
    // but bob is told he was removed
    assert_eq!(kinds(&bo, &cb).iter().filter(|k| *k == "projects.unshared").count(), 1);
}

#[test]
fn export_holds_the_whole_project() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let t = a.task(&al, &p, "x");
    a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "archived": true}));
    a.task(&al, &p, "y");
    a.ok(&al, "tasks.labels.create", json!({"project": p, "name": "l"}));
    a.ok(&al, "discussion.add", json!({"project": p, "task": t["id"], "body": "c"}));
    let e = a.ok(&al, "export.project", json!({"project": p}));
    assert_eq!(e["tasks"].as_array().unwrap().len(), 2, "archived tasks are included");
    assert_eq!(e["labels"].as_array().unwrap().len(), 1);
    assert_eq!(e["comments"].as_array().unwrap().len(), 1);
    assert_eq!(a.err(&who("bob"), "export.project", json!({"project": p})).category, Category::NotFound);
}

#[test]
fn archived_tasks_can_only_be_restored() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let t = a.task(&al, &p, "x");
    a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "archived": true}));
    assert!(a.ok(&al, "tasks.list", json!({"project": p}))["tasks"].as_array().unwrap().is_empty());
    assert_eq!(a.ok(&al, "tasks.list", json!({"project": p, "archived": true}))["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(a.err(&al, "tasks.update", json!({"project": p, "id": t["id"], "title": "y"})).reason.as_deref(), Some("tasks.archived"));
    assert_eq!(a.err(&al, "tasks.move", json!({"project": p, "id": t["id"]})).reason.as_deref(), Some("tasks.archived"));
    a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "archived": false}));
}

#[test]
fn deleting_a_project_removes_everything_in_it_after_the_commit() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Home");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.task(&al, &p, "x");
    a.ok(&al, "discussion.add", json!({"project": p, "task": t["id"], "body": "c"}));
    a.ok(&al, "tasks.labels.create", json!({"project": p, "name": "l"}));
    a.settle();
    let cb = a.core.pulse_now().unwrap();
    a.ok(&al, "projects.delete", json!({"project": p}));
    assert_eq!(a.err(&al, "tasks.list", json!({"project": p})).category, Category::NotFound);
    assert_eq!(a.err(&bo, "tasks.list", json!({"project": p})).category, Category::NotFound);
    assert!(a.ok(&bo, "projects.list", json!({}))["projects"].as_array().unwrap().is_empty());
    let kinds: Vec<String> = a.core.pulse(&bo, Some(&cb), 50).unwrap().events.iter().map(|e| e.kind.clone()).collect();
    assert_eq!(kinds, ["projects.deleted"], "members hear that it is gone");
    a.settle();
}

#[test]
fn a_retried_create_runs_once() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let one = a.core.call_as(&al, "tasks.create", json!({"project": p, "title": "once"}), Some("k")).unwrap();
    let two = a.core.call_as(&al, "tasks.create", json!({"project": p, "title": "once"}), Some("k")).unwrap();
    assert!(two.replayed);
    assert_eq!(one.output["id"], two.output["id"]);
    assert_eq!(a.titles(&al, &p, "todo"), ["once"]);
}

#[test]
fn prefs_default_and_change_and_tell_only_their_owner() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    assert_eq!(a.ok(&al, "prefs.get", json!({}))["theme"], "phantom-onyx");
    assert_eq!(a.ok(&al, "prefs.get", json!({}))["scheme"], "auto");
    let (ca, cb) = (a.core.pulse_now().unwrap(), a.core.pulse_now().unwrap());
    a.ok(&al, "prefs.set", json!({"theme": "ink", "language": "ar"}));
    assert_eq!(a.ok(&al, "prefs.get", json!({}))["language"], "ar");
    assert_eq!(a.ok(&bo, "prefs.get", json!({}))["language"], "en");
    assert_eq!(a.core.pulse(&al, Some(&ca), 10).unwrap().events.len(), 1);
    assert!(a.core.pulse(&bo, Some(&cb), 10).unwrap().events.is_empty());
}

#[test]
fn input_that_could_hurt_is_refused_before_any_plugin_sees_it() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    for bad in [json!({"project": p, "title": ""}), json!({"project": p, "title": "x", "priority": 11}), json!({"project": p, "title": "x", "due": "tomorrow"}), json!({"project": p, "title": "x", "nope": 1})] {
        assert_eq!(a.err(&al, "tasks.create", bad).category, Category::Invalid);
    }
    assert_eq!(a.err(&al, "tasks.create", json!({"title": "no project"})).category, Category::Invalid);
}

#[test]
fn memory_and_sqlite_tell_the_same_story() {
    fn story(a: &App) -> Vec<Value> {
        let (al, bo) = (who("alice"), who("bob"));
        let mut out = vec![];
        let p = a.project(&al, "Home");
        a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
        let l = a.ok(&al, "tasks.labels.create", json!({"project": p, "name": "x"}));
        for (i, n) in ["a", "b", "c", "d"].iter().enumerate() {
            let t = a.ok(&if i % 2 == 0 { al.clone() } else { bo.clone() }, "tasks.create", json!({"project": p, "title": n, "priority": i, "assignee": "bob", "labels": [l["id"]]}));
            out.push(t);
        }
        let first = out[0]["id"].clone();
        a.ok(&bo, "tasks.move", json!({"project": p, "id": out[3]["id"], "after": first}));
        a.ok(&al, "tasks.update", json!({"project": p, "id": first, "status": "done"}));
        a.ok(&al, "discussion.add", json!({"project": p, "task": first, "body": "hi"}));
        a.settle();
        out.push(a.ok(&al, "tasks.list", json!({"project": p})));
        out.push(a.ok(&bo, "tasks.my", json!({})));
        out.push(a.ok(&bo, "inbox.list", json!({})));
        out.push(a.ok(&al, "export.project", json!({"project": p})));
        out.push(a.ok(&al, "audit.list", json!({"project": p})));
        out
    }
    assert_eq!(story(&app_on("memory")), story(&app_on("sqlite")));
}

#[test]
fn a_viewer_role_sees_what_they_may_do_in_describe() {
    let a = app();
    let d = a.core.describe(&viewer("vic"));
    assert_eq!(d["operations"]["projects.create"]["allowed"], false);
    assert_eq!(d["operations"]["prefs.get"]["allowed"], true);
    assert_eq!(d["permissions"]["projects.read"]["held"], true);
    let kinds: std::collections::BTreeMap<String, String> = d["plugins"].as_array().unwrap().iter().filter(|p| p["state"] == "active").map(|p| (p["id"].as_str().unwrap().to_string(), p["kind"].as_str().unwrap().to_string())).collect();
    assert_eq!(kinds["@madar/notify-inbox"], "provider");
    assert_eq!(kinds["@nuah/theme-phantom-onyx"], "theme");
    assert_eq!(kinds["@nuah/db-memory"], "adapter");
    assert_eq!(kinds["@madar/tasks"], "feature");
    assert_eq!(d["themes"].as_array().unwrap().len(), 9);
    let onyx = d["themes"].as_array().unwrap().iter().find(|t| t["id"] == "@nuah/theme-phantom-onyx").expect("the default preset is there");
    assert_eq!(onyx["tokens"]["schema"], "theme/1");
    assert_eq!(d["extension_points"]["notify.channel"]["providers"], json!(["@madar/notify-inbox"]));
}

#[test]
fn the_time_a_task_was_made_comes_from_the_clock_port() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    a.clock.advance(5000);
    let t = a.task(&al, &p, "x");
    assert_eq!(t["created_at"], 1_700_000_005_000i64);
}

#[test]
fn sign_in_gives_an_expiring_session() {
    let clock = FixedClock::at(1_700_000_000_000);
    let hash = AuthPassword::hash_password("correct horse");
    let mut p = profile_server(":memory:", json!([{"name": "alice", "password_hash": hash, "roles": ["member"]}]));
    p.enabled.retain(|e| !["@nuah/db-sqlite", "@nuah/clock-system", "@nuah/ids-random"].contains(&e.as_str()));
    p.enabled.extend(["@nuah/db-memory", "@nuah/clock-fixed", "@nuah/ids-sequential"].map(String::from));
    p.settings.remove("db-sqlite");
    p.settings.insert("auth-password".into(), json!({"session_hours": 1, "accounts": [{"name": "alice", "password_hash": hash, "roles": ["member"]}]}));
    p.grants.insert("auth-password".into(), vec![]);
    let core = Core::start(&distribution_with(p, vec![Arc::new(TestClock(clock.clone())), Arc::new(TestIds)])).unwrap_or_else(|p| panic!("{p:#?}"));
    let call = |cred: Option<&str>, op: &str, input: Value| core.call(CallRequest { credential: cred.map(String::from), op: op.into(), input, key: None, contract: None });
    assert_eq!(call(None, "projects.list", json!({})).unwrap_err().category, Category::Unauthenticated, "no credential, no entry");
    let bad = call(None, "auth.sign_in", json!({"name": "alice", "password": "wrong"})).unwrap_err();
    assert_eq!((bad.category, bad.reason.as_deref()), (Category::Unauthenticated, Some("auth.bad_credentials")));
    assert_eq!(call(None, "auth.sign_in", json!({"name": "nobody", "password": "x"})).unwrap_err().reason.as_deref(), Some("auth.bad_credentials"), "same answer for an unknown name");
    let s = call(None, "auth.sign_in", json!({"name": "alice", "password": "correct horse"})).unwrap().output;
    let token = s["token"].as_str().unwrap().to_string();
    let who = call(Some(&token), "auth.who", json!({})).unwrap().output;
    assert_eq!(who["display"], "alice");
    assert_ne!(who["subject"], "alice", "the subject is an opaque id, not the login name");
    assert_eq!(who["subject"], s["who"]["subject"]);
    assert!(call(Some(&token), "projects.create", json!({"name": "Home"})).is_ok());
    assert_eq!(call(Some("made-up"), "projects.list", json!({})).unwrap_err().category, Category::Unauthenticated);
    clock.advance(30 * 60 * 1000);
    call(Some(&token), "auth.refresh", json!({"token": token})).unwrap();
    clock.advance(45 * 60 * 1000);
    assert!(call(Some(&token), "projects.list", json!({})).is_ok(), "refreshed, so still valid");
    clock.advance(2 * 60 * 60 * 1000);
    assert_eq!(call(Some(&token), "projects.list", json!({})).unwrap_err().category, Category::Unauthenticated, "expired");
    let s2 = call(None, "auth.sign_in", json!({"name": "alice", "password": "correct horse"})).unwrap().output;
    let t2 = s2["token"].as_str().unwrap().to_string();
    call(Some(&t2), "auth.sign_out", json!({"token": t2})).unwrap();
    assert_eq!(call(Some(&t2), "projects.list", json!({})).unwrap_err().category, Category::Unauthenticated, "signed out");
    // the public description says how to sign in and nothing else
    let public = core.describe_public();
    assert!(public["operations"].as_object().unwrap().keys().all(|k| k == "auth.sign_in"));
}

// ---- the database file outlives the process (PRD criteria 6 and 9) -------------------------------

fn temp_db() -> String {
    let dir = std::env::temp_dir().join(format!("madar-test-{}", uuid_like()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("madar.db").display().to_string()
}
fn uuid_like() -> String {
    format!("{}-{:?}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos())
}
fn start_file(path: &str, without: &[&str]) -> std::result::Result<Core, Vec<Problem>> {
    let mut p = profile_embedded(path);
    // `without` names plugins by their short names
    let hit = |id: &str| without.iter().any(|w| id == *w || id.ends_with(&format!("/{w}")));
    p.enabled.retain(|e| !hit(e));
    p.grants.retain(|k, _| !hit(k));
    Core::start(&distribution(p))
}

#[test]
fn pulse_resumes_after_the_process_restarts() {
    let path = temp_db();
    let al = who("alice");
    let core = start_file(&path, &[]).unwrap();
    let p = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output["id"].as_str().unwrap().to_string();
    let cursor = core.pulse_now().unwrap();
    core.call_as(&al, "tasks.create", json!({"project": p, "title": "after the cursor"}), None).unwrap();
    drop(core);

    let core = start_file(&path, &[]).unwrap();
    let batch = core.pulse(&al, Some(&cursor), 100).unwrap();
    let kinds: Vec<_> = batch.events.iter().map(|e| e.kind.as_str()).collect();
    assert!(kinds.contains(&"tasks.created"), "the event written before the restart is still there: {kinds:?}");
    assert!(!batch.reset, "a cursor from before the restart still works");
    // A person who cannot see the project still hears nothing.
    let other = core.pulse(&who("mallory"), Some(&cursor), 100).unwrap();
    assert!(other.events.iter().all(|e| e.kind != "tasks.created"));
}

#[test]
fn switching_a_plugin_off_removes_what_it_adds_and_keeps_its_data() {
    let path = temp_db();
    let al = who("alice");
    let core = start_file(&path, &[]).unwrap();
    let p = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output["id"].as_str().unwrap().to_string();
    core.call_as(&al, "tasks.create", json!({"project": p, "title": "Keep me"}), None).unwrap();
    drop(core);

    // Everything that needs tasks goes off with it.
    let without = ["tasks", "discussion", "export", "notify", "notify-inbox", "audit", "quota"];
    let off = start_file(&path, &without).unwrap_or_else(|p| panic!("{p:#?}"));
    let d = off.describe(&al);
    assert!(d["operations"].get("tasks.create").is_none(), "its operations are gone");
    assert!(d["operations"].get("projects.create").is_some(), "the rest still works");
    assert_eq!(off.call_as(&al, "tasks.create", json!({"project": p, "title": "x"}), None).unwrap_err().category, Category::NotFound);
    drop(off);

    let back = start_file(&path, &[]).unwrap();
    let list = back.call_as(&al, "tasks.list", json!({"project": p}), None).unwrap().output;
    assert_eq!(list["tasks"][0]["title"], "Keep me", "its data was kept while it was off");
}

// ---- Slots (ADR 0016; PRD criteria 4 and 8) -----------------------------------------------------

struct Pin(Value);
impl Plugin for Pin {
    fn manifest(&self) -> Manifest {
        serde_json::from_value(self.0.clone()).expect("test manifest")
    }
}

fn pin_with(slots: Value) -> Arc<dyn Plugin> {
    Arc::new(Pin(json!({"id": "@acme/pin", "version": "0.1.0", "name": "Pin", "namespaces": ["pin"],
        "requires": {"plugins": ["@madar/tasks"]}, "slots": slots})))
}

fn slot_problems(slots: Value) -> Vec<Problem> {
    let mut p = profile_embedded(":memory:");
    p.enabled.push("@acme/pin".into());
    Core::check(&distribution_with(p, vec![pin_with(slots)]))
}

fn archive_item() -> Value {
    json!({"slot": "task.actions", "id": "pin.archive", "label": {"en": "Archive now", "ar": "أرشفة"},
        "operation": "tasks.update", "args": {"project": "$project.id", "id": "$task.id", "archived": true}})
}

#[test]
fn a_plugin_adds_a_button_by_declaring_it_and_nobody_else_changes() {
    let mut p = profile_test(&[]);
    p.enabled.push("@acme/pin".into());
    let dist = distribution_with(p, vec![pin_with(json!([archive_item()])), Arc::new(TestClock(FixedClock::at(1_700_000_000_000))), Arc::new(TestIds)]);
    let core = Core::start(&dist).unwrap_or_else(|p| panic!("{p:#?}"));
    let d = core.describe(&who("alice"));
    let items: Vec<&Value> = d["slots"].as_array().unwrap().iter().collect();
    // Madar's export item and the new one, in their Slots, each in the caller's reach.
    assert!(items.iter().any(|i| i["id"] == "export.project" && i["slot"] == "project.actions"));
    let mine = items.iter().find(|i| i["id"] == "pin.archive").expect("the new item is listed");
    assert_eq!((mine["slot"].as_str(), mine["operation"].as_str(), mine["plugin"].as_str()), (Some("task.actions"), Some("tasks.update"), Some("@acme/pin")));
    assert_eq!(mine["label"]["en"], "Archive now");
    // The item does what its Operation does: run it the way a Face would, with the context filled in.
    let al = who("alice");
    let proj = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output;
    let task = core.call_as(&al, "tasks.create", json!({"project": proj["id"], "title": "Old"}), None).unwrap().output;
    let ran = core.call_as(&al, "tasks.update", json!({"project": proj["id"], "id": task["id"], "archived": true}), None).unwrap().output;
    assert_eq!(ran["archived"], true);
}

#[test]
fn before_sign_in_a_face_learns_nothing_about_slots() {
    let a = app();
    assert!(a.core.describe_public().get("slots").is_none());
    assert!(!a.core.describe(&who("alice"))["slots"].as_array().unwrap().is_empty());
}

#[test]
fn the_resolver_rejects_slot_items_that_cannot_work() {
    assert_eq!(slot_problems(json!([archive_item()])), vec![], "the good item resolves");
    let codes = |slots: Value| slot_problems(slots).into_iter().map(|p| (p.code, p.message)).collect::<Vec<_>>();
    let with = |change: &dyn Fn(&mut Value)| {
        let mut i = archive_item();
        change(&mut i);
        codes(json!([i]))
    };
    let has = |found: &[(String, String)], code: &str, word: &str| found.iter().any(|(c, m)| c == code && m.contains(word));
    assert!(has(&with(&|i| i["operation"] = json!("tasks.nope")), "bad_slot", "no enabled plugin declares"));
    assert!(has(&with(&|i| { i["args"].as_object_mut().unwrap().remove("id"); }), "bad_slot", "requires id"));
    assert!(has(&with(&|i| { i["args"]["colour"] = json!("red"); }), "bad_slot", "no input called colour"));
    assert!(has(&with(&|i| i["id"] = json!("elsewhere.archive")), "name_outside_namespace", "elsewhere.archive"));
    assert!(has(&with(&|i| i["label"] = json!({"ar": "x"})), "bad_slot", "English label"));
    assert!(has(&with(&|i| i["args"]["id"] = json!("$Task id")), "bad_slot", "not `$name`"));
    assert!(has(&with(&|i| i["result"] = json!("download")), "bad_slot", "file"));
    assert!(has(&with(&|i| i["slot"] = json!("Task Actions")), "bad_slot", "lowercase"));
    // The same id twice, in one plugin.
    assert!(has(&codes(json!([archive_item(), archive_item()])), "duplicate_slot_item", "pin.archive"));
}

// ---- policy-allow-all (ADR 0018) ------------------------------------------------------------------

#[test]
fn allow_all_ignores_roles_but_not_what_the_project_grants() {
    let clock = FixedClock::at(1_700_000_000_000);
    let mut p = profile_test(&[]);
    p.enabled.retain(|e| e != "@nuah/policy-roles");
    p.enabled.push("policy-allow-all".into());
    let core = Core::start(&distribution_with(p, vec![Arc::new(TestClock(clock)), Arc::new(TestIds)])).unwrap_or_else(|p| panic!("{p:#?}"));
    // Nobody has any Role: under allow-all that makes no difference.
    let (owner, viewer, stranger) = (Identity::new("alice", "alice", &[]), Identity::new("bob", "bob", &[]), Identity::new("eve", "eve", &[]));
    let call = |who: &Identity, op: &str, input: Value| core.call_as(who, op, input, None).map(|r| r.output);
    let proj = call(&owner, "projects.create", json!({"name": "Home"})).expect("no Role is needed to start a project").clone();
    let id = proj["id"].as_str().unwrap().to_string();
    call(&owner, "projects.share", json!({"project": id, "subject": "bob", "level": "viewer"})).unwrap();

    assert!(call(&viewer, "tasks.list", json!({"project": id})).is_ok(), "a viewer reads");
    let denied = call(&viewer, "tasks.create", json!({"project": id, "title": "x"})).unwrap_err();
    assert_eq!(denied.category, Category::Denied, "a viewer may not write, whatever the policy");
    assert_eq!(call(&stranger, "tasks.list", json!({"project": id})).unwrap_err().category, Category::NotFound);
    // The can-list tells the viewer the truth too.
    let seen = call(&viewer, "projects.get", json!({"project": id})).unwrap();
    assert!(!seen["can"].as_array().unwrap().iter().any(|c| c == "projects.write"), "{}", seen["can"]);
    assert!(call(&owner, "tasks.create", json!({"project": id, "title": "ok"})).is_ok());
}

// ---- preferences (ADR 0021) -----------------------------------------------------------------------

#[test]
fn each_plugin_declares_its_own_preferences_and_the_prefs_plugin_checks_them() {
    let a = app();
    let al = who("alice");
    let keys: Vec<String> = a.ok(&al, "prefs.schema", json!({}))["items"].as_array().unwrap().iter().map(|i| i["key"].as_str().unwrap().to_string()).collect();
    for k in ["theme", "language", "density", "calendar", "confirm_before_delete", "tasks.default_priority", "tasks.due_soon_days", "projects.default_tab"] {
        assert!(keys.contains(&k.to_string()), "{k} is declared: {keys:?}");
    }
    let got = a.ok(&al, "prefs.get", json!({}));
    assert_eq!(got["tasks.default_priority"], 0);
    assert_eq!(got["confirm_before_delete"], true);
    a.ok(&al, "prefs.set", json!({"tasks.default_priority": 7, "calendar": "hijri", "avatar_color": "#1a2b3c"}));
    let got = a.ok(&al, "prefs.get", json!({}));
    assert_eq!((got["tasks.default_priority"].clone(), got["calendar"].clone(), got["avatar_color"].clone()), (json!(7), json!("hijri"), json!("#1a2b3c")));
    // refused: unknown key, out of range, not a choice, wrong type, bad colour
    for bad in [json!({"nope": 1}), json!({"tasks.default_priority": 11}), json!({"calendar": "lunar"}), json!({"confirm_before_delete": "yes"}), json!({"avatar_color": "red"})] {
        assert_eq!(a.err(&al, "prefs.set", bad.clone()).category, Category::Invalid, "{bad}");
    }
    // one bad key means nothing is stored
    a.err(&al, "prefs.set", json!({"density": "compact", "calendar": "lunar"}));
    assert_eq!(a.ok(&al, "prefs.get", json!({}))["density"], "comfortable");
    // only your own
    assert_eq!(a.ok(&who("bob"), "prefs.get", json!({}))["tasks.default_priority"], 0);
}

#[test]
fn a_plugin_that_offers_preferences_still_runs_when_the_prefs_plugin_is_off() {
    let path = temp_db();
    let core = start_file(&path, &["prefs"]).unwrap_or_else(|p| panic!("{p:#?}"));
    let al = who("alice");
    let p = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output["id"].as_str().unwrap().to_string();
    core.call_as(&al, "tasks.create", json!({"project": p, "title": "still works"}), None).unwrap();
    assert!(core.call_as(&al, "prefs.get", json!({}), None).is_err(), "the Operation is gone with its plugin");
}

// ---- knowledge, pages, links, editor (ADR 0019, 0020, 0022) ---------------------------------------------------

fn doc_with(text_: &str, refs: &[(&str, &str)]) -> Value {
    let mut kids = vec![json!({"type": "text", "text": text_})];
    for (k, i) in refs {
        kids.push(json!({"type": "entityRef", "attrs": {"kind": k, "id": i}}));
    }
    json!({"type": "doc", "content": [{"type": "paragraph", "content": kids}]})
}

#[test]
fn project_pages_form_a_tree_that_follows_the_projects_access() {
    let a = app();
    let (al, bo, ve, mal) = (who("alice"), who("bob"), viewer("vera"), who("mallory"));
    let p = a.project(&al, "Docs");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    a.ok(&al, "projects.share", json!({"project": p, "subject": "vera", "level": "viewer"}));
    let root = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Guide"}));
    let (r, ) = (root["id"].as_str().unwrap().to_string(),);
    let b = a.ok(&bo, "knowledge.create", json!({"project": p, "title": "Setup", "parent": r}))["id"].as_str().unwrap().to_string();
    let c = a.ok(&bo, "knowledge.create", json!({"project": p, "title": "Usage", "parent": r}))["id"].as_str().unwrap().to_string();
    let titles = |who: &Identity| -> Vec<String> { a.ok(who, "knowledge.list", json!({"project": p}))["pages"].as_array().unwrap().iter().map(|x| x["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(titles(&ve), ["Guide", "Setup", "Usage"]);
    // the viewer reads but does not write; a stranger does not even know the project
    assert_eq!(a.ok(&ve, "knowledge.get", json!({"project": p, "id": b}))["title"], "Setup");
    assert_eq!(a.err(&ve, "knowledge.create", json!({"project": p, "title": "No"})).category, Category::Denied);
    assert_eq!(a.err(&mal, "knowledge.list", json!({"project": p})).category, Category::NotFound);
    // a page of another project is not reachable through this one
    let q = a.project(&al, "Other");
    assert_eq!(a.err(&al, "knowledge.get", json!({"project": q, "id": b})).category, Category::NotFound);
    // reorder: Usage before Setup
    a.ok(&bo, "knowledge.move", json!({"project": p, "id": c, "parent": r, "before": b}));
    let kids: Vec<String> = a.ok(&al, "knowledge.list", json!({"project": p}))["pages"].as_array().unwrap().iter().filter(|x| x["parent"] == r.as_str()).map(|x| x["title"].as_str().unwrap().to_string()).collect();
    assert_eq!(kids, ["Usage", "Setup"]);
    // a page cannot go under itself or its own child
    assert_eq!(a.err(&al, "knowledge.move", json!({"project": p, "id": r, "parent": b})).category, Category::Invalid);
    assert_eq!(a.err(&al, "knowledge.move", json!({"project": p, "id": r, "parent": r})).category, Category::Invalid);
    // move under another page, then delete the branch
    a.ok(&al, "knowledge.move", json!({"project": p, "id": b, "parent": c}));
    let gone = a.ok(&al, "knowledge.delete", json!({"project": p, "id": c}));
    assert_eq!(gone["removed"], 2);
    assert_eq!(titles(&al), ["Guide"]);
    // search by title
    a.ok(&al, "knowledge.create", json!({"project": p, "title": "Release notes"}));
    assert_eq!(a.ok(&al, "knowledge.search", json!({"project": p, "q": "RELEASE"}))["pages"].as_array().unwrap().len(), 1);
}

#[test]
fn pages_nest_to_a_limit_and_an_edit_of_a_stale_copy_is_a_conflict() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Deep");
    let mut parent = Value::Null;
    for n in 1..=12 {
        let r = a.ok(&al, "knowledge.create", json!({"project": p, "title": format!("L{n}"), "parent": parent}));
        parent = r["id"].clone();
    }
    assert_eq!(a.err(&al, "knowledge.create", json!({"project": p, "title": "L13", "parent": parent})).reason.as_deref(), Some("pages.too_deep"));
    let page = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Edit me"}));
    let (id, rev) = (page["id"].as_str().unwrap(), page["rev"].as_u64().unwrap());
    a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "title": "First", "expected_rev": rev}));
    let e = a.err(&al, "knowledge.update", json!({"project": p, "id": id, "title": "Second", "expected_rev": rev}));
    assert_eq!((e.category, e.reason.as_deref()), (Category::Conflict, Some("pages.stale_revision")));
    // a body that is not a document is refused before anything is stored
    assert_eq!(a.err(&al, "knowledge.update", json!({"project": p, "id": id, "body": {"type": "paragraph"}})).category, Category::Invalid);
}

#[test]
fn personal_pages_are_private_to_their_owner() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let n = a.ok(&al, "pages.create", json!({"title": "Diary", "body": doc_with("secret", &[])}));
    let id = n["id"].as_str().unwrap();
    assert_eq!(a.ok(&al, "pages.get", json!({"id": id}))["title"], "Diary");
    assert_eq!(a.err(&bo, "pages.get", json!({"id": id})).category, Category::NotFound);
    assert!(a.ok(&bo, "pages.list", json!({}))["pages"].as_array().unwrap().is_empty());
    assert_eq!(a.err(&bo, "pages.update", json!({"id": id, "title": "mine now"})).category, Category::NotFound);
    // a note never shows up as a project page, and the other way round
    let p = a.project(&al, "P");
    assert_eq!(a.err(&al, "knowledge.get", json!({"project": p, "id": id})).category, Category::NotFound);
    // nothing about a note reaches another person's live feed
    let (cb, ) = (a.core.pulse_now().unwrap(), );
    a.ok(&al, "pages.update", json!({"id": id, "title": "Journal"}));
    assert!(a.core.pulse(&bo, Some(&cb), 10).unwrap().events.is_empty());
}

#[test]
fn references_remember_what_refers_to_what_and_follow_edits() {
    let a = app();
    let (al, mal) = (who("alice"), who("mallory"));
    let p = a.project(&al, "Wiki");
    let t = a.task(&al, &p, "Fix login");
    let target = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Design"}))["id"].as_str().unwrap().to_string();
    let t_id = t["id"].as_str().unwrap().to_string();
    let src = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Plan", "body": doc_with("see", &[("pages.page", &target), ("tasks.task", &t_id)])}));
    let src_id = src["id"].as_str().unwrap().to_string();
    a.settle();
    let to = |kind: &str, id: &str| -> Vec<String> { a.ok(&al, "refs.to", json!({"project": p, "kind": kind, "id": id}))["links"].as_array().unwrap().iter().map(|l| l["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(to("pages.page", &target), ["Plan"]);
    assert_eq!(to("tasks.task", &t_id), ["Plan"]);
    // editing the source to drop one reference removes that link only
    a.ok(&al, "knowledge.update", json!({"project": p, "id": src_id, "body": doc_with("see", &[("pages.page", &target)])}));
    a.settle();
    assert_eq!(to("pages.page", &target), ["Plan"]);
    assert!(to("tasks.task", &t_id).is_empty());
    // deleting the source removes the rest
    a.ok(&al, "knowledge.delete", json!({"project": p, "id": src_id}));
    a.settle();
    assert!(to("pages.page", &target).is_empty());
    // backlinks are answered only to people who can see the project
    assert_eq!(a.err(&mal, "refs.to", json!({"project": p, "kind": "pages.page", "id": target})).category, Category::NotFound);
    // pages: your own, and only yours
    let n = a.ok(&al, "pages.create", json!({"title": "Idea", "body": doc_with("x", &[("pages.page", "elsewhere")])}));
    a.settle();
    let mine = a.ok(&al, "refs.mine", json!({"kind": "pages.page", "id": "elsewhere"}));
    assert_eq!(mine["links"][0]["from"]["id"], n["id"]);
    assert!(a.ok(&mal, "refs.mine", json!({"kind": "pages.page", "id": "elsewhere"}))["links"].as_array().unwrap().is_empty());
}

#[test]
fn the_editor_offers_the_blocks_plugins_declare() {
    let a = app();
    let blocks = a.ok(&who("alice"), "editor.blocks", json!({}));
    let ids: Vec<&str> = blocks["blocks"].as_array().unwrap().iter().map(|b| b["id"].as_str().unwrap()).collect();
    for want in ["heading1", "codeBlock", "taskList", "toggle", "calloutWarning", "image", "youtube", "entityRef"] {
        assert!(ids.contains(&want), "{want} in {ids:?}");
    }
    assert_eq!(blocks["blocks"][0]["plugin"], "@madar/editor-basic");
}

#[test]
fn switching_pages_off_keeps_its_data_and_the_rest_runs() {
    let path = temp_db();
    let al = who("alice");
    let core = start_file(&path, &[]).unwrap();
    let p = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output["id"].as_str().unwrap().to_string();
    core.call_as(&al, "knowledge.create", json!({"project": p, "title": "Kept"}), None).unwrap();
    drop(core);
    let core = start_file(&path, &["pages", "refs"]).unwrap_or_else(|p| panic!("{p:#?}"));
    assert!(core.call_as(&al, "knowledge.list", json!({"project": p}), None).is_err());
    core.call_as(&al, "tasks.create", json!({"project": p, "title": "still fine"}), None).unwrap();
    drop(core);
    let core = start_file(&path, &[]).unwrap();
    assert_eq!(core.call_as(&al, "knowledge.list", json!({"project": p}), None).unwrap().output["pages"][0]["title"], "Kept");
}

// ---- custom attributes, query, stats, focus, rich descriptions (ADR 0024) -----------------------------------

fn project_with_attributes(a: &App, al: &Identity) -> String {
    let attrs = json!([{"key": "estimate", "label": "Estimate", "type": "number"}, {"key": "area", "label": "Area", "type": "choice", "choices": ["web", "api"]},
                       {"key": "ship", "label": "Ship date", "type": "date"}, {"key": "blocked", "label": "Blocked", "type": "boolean"}]);
    a.ok(al, "projects.create", json!({"name": "Attr", "attributes": attrs}))["id"].as_str().unwrap().to_string()
}

#[test]
fn custom_attributes_are_defined_by_the_project_and_checked_on_tasks() {
    let a = app();
    let al = who("alice");
    let p = project_with_attributes(&a, &al);
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "A", "custom": {"estimate": 5, "area": "web", "ship": "2026-12-01", "blocked": false}}));
    assert_eq!(t["custom"]["estimate"], 5);
    for bad in [json!({"nope": 1}), json!({"estimate": "five"}), json!({"area": "mobile"}), json!({"ship": "soon"}), json!({"blocked": "no"})] {
        assert_eq!(a.err(&al, "tasks.create", json!({"project": p, "title": "B", "custom": bad.clone()})).category, Category::Invalid, "{bad}");
    }
    // update merges, and null removes one value
    let u = a.ok(&al, "tasks.update", json!({"project": p, "id": t["id"], "custom": {"estimate": 8, "area": null}}));
    assert_eq!((u["custom"]["estimate"].clone(), u["custom"]["area"].clone(), u["custom"]["ship"].clone()), (json!(8), Value::Null, json!("2026-12-01")));
    // the schema itself is checked: duplicate keys, a choice without choices
    let dup = json!([{"key": "x", "label": "X", "type": "text"}, {"key": "x", "label": "X2", "type": "text"}]);
    assert_eq!(a.err(&al, "projects.update", json!({"project": p, "attributes": dup})).category, Category::Invalid);
    let lonely = json!([{"key": "c", "label": "C", "type": "choice"}]);
    assert_eq!(a.err(&al, "projects.update", json!({"project": p, "attributes": lonely})).category, Category::Invalid);
}

#[test]
fn tasks_can_be_found_filtered_and_sorted_including_by_a_custom_attribute() {
    let a = app();
    let al = who("alice");
    let p = project_with_attributes(&a, &al);
    for (title, prio, est, area, due) in [("Alpha", 2, 8, "web", "2026-01-05"), ("Beta", 9, 3, "api", "2026-01-01"), ("Gamma", 5, 5, "web", "2026-01-09")] {
        a.ok(&al, "tasks.create", json!({"project": p, "title": title, "priority": prio, "due": due, "custom": {"estimate": est, "area": area}}));
    }
    let titles = |input: Value| -> Vec<String> { a.ok(&al, "tasks.query", input)["tasks"].as_array().unwrap().iter().map(|t| t["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(titles(json!({"project": p, "sort": "priority", "desc": true})), ["Beta", "Gamma", "Alpha"]);
    assert_eq!(titles(json!({"project": p, "sort": "custom.estimate"})), ["Beta", "Gamma", "Alpha"]);
    assert_eq!(titles(json!({"project": p, "custom": {"area": "web"}, "sort": "due"})), ["Alpha", "Gamma"]);
    assert_eq!(titles(json!({"project": p, "priority_min": 5, "sort": "title"})), ["Beta", "Gamma"]);
    assert_eq!(titles(json!({"project": p, "due_before": "2026-01-05", "sort": "due"})), ["Beta", "Alpha"]);
    assert_eq!(titles(json!({"project": p, "q": "amm"})), ["Gamma"]);
    // paging reports the total
    let page = a.ok(&al, "tasks.query", json!({"project": p, "sort": "title", "limit": 2}));
    assert_eq!((page["tasks"].as_array().unwrap().len(), page["total"].clone(), page["next"].clone()), (2, json!(3), json!(2)));
    // sorting by something that is not a column or an attribute is refused
    assert_eq!(a.err(&al, "tasks.query", json!({"project": p, "sort": "custom.nope"})).category, Category::Invalid);
    assert_eq!(a.err(&al, "tasks.query", json!({"project": p, "sort": "notes; drop"})).category, Category::Invalid);
    // a stranger cannot ask
    assert_eq!(a.err(&who("mallory"), "tasks.query", json!({"project": p})).category, Category::NotFound);
}

#[test]
fn the_overview_counts_columns_bands_overdue_and_completions_per_day() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Stats");
    let today = date_of_clock(&a);
    let t1 = a.ok(&al, "tasks.create", json!({"project": p, "title": "late", "priority": 9, "due": "2020-01-01"}));
    a.ok(&al, "tasks.create", json!({"project": p, "title": "fine", "priority": 1}));
    let t3 = a.ok(&al, "tasks.create", json!({"project": p, "title": "finished"}));
    a.ok(&al, "tasks.update", json!({"project": p, "id": t3["id"], "status": "done"}));
    let s = a.ok(&al, "tasks.stats", json!({"project": p, "days": 7}));
    assert_eq!((s["total"].clone(), s["open"].clone(), s["done"].clone(), s["overdue"].clone()), (json!(3), json!(2), json!(1), json!(1)));
    assert_eq!(s["by_status"]["todo"], 2);
    assert_eq!(s["by_status"]["done"], 1);
    assert_eq!((s["by_band"]["urgent"].clone(), s["by_band"]["low"].clone()), (json!(1), json!(1)));
    let days = s["completed_per_day"].as_array().unwrap();
    assert_eq!(days.len(), 7);
    assert_eq!(days.last().unwrap()["date"], today.as_str());
    assert_eq!(days.last().unwrap()["n"], 1);
    let _ = t1;
}

fn date_of_clock(a: &App) -> String {
    madar_plugins::util::date_of(a.core.now())
}

#[test]
fn focus_ranks_your_open_tasks_by_urgency_in_two_lists() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Day");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let today = date_of_clock(&a);
    let mk = |title: &str, prio: i64, due: Value| a.ok(&al, "tasks.create", json!({"project": p, "title": title, "priority": prio, "due": due, "assignee": "bob"}))["id"].clone();
    mk("low and undated", 0, Value::Null);
    mk("urgent but far", 9, json!("2099-01-01"));
    mk("due today", 3, json!(today));
    mk("a week late", 3, json!(madar_plugins::util::days_before(&today, 7)));
    for n in 0..8 {
        mk(&format!("filler {n}"), 1, Value::Null);
    }
    a.ok(&al, "tasks.create", json!({"project": p, "title": "not bob's", "priority": 10}));
    let f = a.ok(&bo, "tasks.focus", json!({}));
    let names = |k: &str| -> Vec<String> { f[k].as_array().unwrap().iter().map(|t| t["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(names("start").len(), 5);
    assert_eq!(names("also").len(), 7);
    // 3*1.5 + 7*2 = 18.5 beats 9*1.5 = 13.5, which beats due today 3*1.5 + 3 = 7.5
    assert_eq!(&names("start")[..3], ["a week late", "urgent but far", "due today"]);
    assert!(!names("start").iter().chain(names("also").iter()).any(|t| t == "not bob's"));
    assert_eq!(f["open"], 12);
}

#[test]
fn a_rich_task_description_is_checked_and_its_references_become_links() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Rich");
    let page = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Spec"}))["id"].as_str().unwrap().to_string();
    assert_eq!(a.err(&al, "tasks.create", json!({"project": p, "title": "bad", "description": {"type": "paragraph"}})).category, Category::Invalid);
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "Implement", "description": doc_with("per the", &[("pages.page", &page)])}));
    a.settle();
    let links = a.ok(&al, "refs.to", json!({"project": p, "kind": "pages.page", "id": page}));
    assert_eq!(links["links"][0]["from"]["id"], t["id"]);
    assert_eq!(links["links"][0]["title"], "Implement");
}

// ---- threads and the timeline (ADR 0024) ---------------------------------------------------------------------

#[test]
fn a_comment_thread_counts_its_replies_and_replies_do_not_nest() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Talk");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.task(&al, &p, "Discuss")["id"].as_str().unwrap().to_string();
    let root = a.ok(&al, "discussion.add", json!({"project": p, "task": t, "body": "start"}))["id"].as_str().unwrap().to_string();
    let r1 = a.ok(&bo, "discussion.add", json!({"project": p, "task": t, "body": "reply one", "parent": root}))["id"].as_str().unwrap().to_string();
    a.ok(&al, "discussion.add", json!({"project": p, "task": t, "body": doc_with("rich reply", &[]), "parent": root}));
    // a reply to a reply is refused
    assert_eq!(a.err(&al, "discussion.add", json!({"project": p, "task": t, "body": "deeper", "parent": r1})).reason.as_deref(), Some("discussion.bad_parent"));
    let roots = a.ok(&al, "discussion.list", json!({"project": p, "task": t, "roots": true}))["comments"].clone();
    assert_eq!(roots.as_array().unwrap().len(), 1);
    assert_eq!(roots[0]["reply_count"], 2);
    assert_eq!(roots[0]["participants"], json!(["bob", "alice"]));
    let thread = a.ok(&al, "discussion.list", json!({"project": p, "task": t, "parent": root}))["comments"].clone();
    assert_eq!(thread.as_array().unwrap().len(), 2);
    // removing a reply lowers the count; removing the root takes the replies with it
    a.ok(&bo, "discussion.remove", json!({"project": p, "id": r1}));
    assert_eq!(a.ok(&al, "discussion.list", json!({"project": p, "task": t, "roots": true}))["comments"][0]["reply_count"], 1);
    a.ok(&al, "discussion.remove", json!({"project": p, "id": root}));
    assert!(a.ok(&al, "discussion.list", json!({"project": p, "task": t}))["comments"].as_array().unwrap().is_empty());
    // a comment needs a task or a page, not both and not neither
    assert_eq!(a.err(&al, "discussion.add", json!({"project": p, "body": "x"})).category, Category::Invalid);
}

#[test]
fn pages_can_be_discussed_and_their_comments_go_with_them() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Docs");
    let pg = a.ok(&al, "knowledge.create", json!({"project": p, "title": "RFC"}))["id"].as_str().unwrap().to_string();
    a.ok(&al, "discussion.add", json!({"project": p, "page": pg, "body": "looks good"}));
    assert_eq!(a.ok(&al, "discussion.list", json!({"project": p, "page": pg}))["comments"].as_array().unwrap().len(), 1);
    // a page of another project cannot be commented on through this one
    let q = a.project(&al, "Elsewhere");
    assert_eq!(a.err(&al, "discussion.add", json!({"project": q, "page": pg, "body": "no"})).category, Category::NotFound);
    a.ok(&al, "knowledge.delete", json!({"project": p, "id": pg}));
    a.settle();
    let comments_left = a.core.call_as(&al, "export.project", json!({"project": p}), None).unwrap().output["comments"].as_array().unwrap().len();
    assert_eq!(comments_left, 0);
}

#[test]
fn the_timeline_merges_comments_and_history_newest_first_and_pages_through_them() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Feed");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let t = a.task(&al, &p, "Story");
    let tid = t["id"].as_str().unwrap().to_string();
    for n in 0..4 {
        a.clock.advance(1000);
        a.ok(&al, "discussion.add", json!({"project": p, "task": tid, "body": format!("note {n}")}));
    }
    a.clock.advance(1000);
    a.ok(&al, "tasks.update", json!({"project": p, "id": tid, "priority": 7}));
    a.settle();
    let target = json!({"type": "tasks.task", "id": tid});
    let first = a.ok(&al, "timeline.feed", json!({"project": p, "target": target, "limit": 3}));
    let kinds: Vec<&str> = first["items"].as_array().unwrap().iter().map(|x| x["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["tasks.updated", "comment", "comment"], "newest first, the owner sees history too");
    let next = first["next"].as_i64().expect("there is more");
    let rest = a.ok(&al, "timeline.feed", json!({"project": p, "target": target, "limit": 10, "before": next}));
    assert!(rest["items"].as_array().unwrap().iter().all(|x| x["at"].as_i64().unwrap() < next));
    assert!(rest["next"].is_null());
    // an editor who is not an owner sees the comments but not the history
    let for_bob = a.ok(&bo, "timeline.feed", json!({"project": p, "target": target}));
    assert!(for_bob["items"].as_array().unwrap().iter().all(|x| x["source"] == "discussion"));
    // a stranger asks and learns nothing
    assert_eq!(a.err(&who("mallory"), "timeline.feed", json!({"project": p, "target": target})).category, Category::NotFound);
}

// ---- workspaces (ADR 0023) --------------------------------------------------------------------------------------

#[test]
fn workspaces_group_the_projects_you_see_and_belong_to_you_alone() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Client work");
    let q = a.project(&al, "Garden");
    let work = a.ok(&al, "workspaces.create", json!({"name": "Work"}))["id"].as_str().unwrap().to_string();
    a.ok(&al, "workspaces.place", json!({"project": p, "workspace": work}));
    let l = a.ok(&al, "workspaces.list", json!({}));
    assert_eq!(l["workspaces"][0]["id"], "default");
    assert_eq!(l["workspaces"].as_array().unwrap().len(), 2);
    assert_eq!(l["placements"], json!([{"project": p, "workspace": work}]));
    // the other person's view is theirs: nothing placed, and Alice's workspace is not theirs to use
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    assert!(a.ok(&bo, "workspaces.list", json!({}))["placements"].as_array().unwrap().is_empty());
    assert_eq!(a.err(&bo, "workspaces.place", json!({"project": p, "workspace": work})).category, Category::NotFound);
    // a workspace with projects in it cannot be deleted; emptied, it can
    assert_eq!(a.err(&al, "workspaces.delete", json!({"id": work})).reason.as_deref(), Some("workspaces.not_empty"));
    a.ok(&al, "workspaces.place", json!({"project": p, "workspace": "default"}));
    a.ok(&al, "workspaces.delete", json!({"id": work}));
    assert_eq!(a.ok(&al, "workspaces.list", json!({}))["workspaces"].as_array().unwrap().len(), 1);
    // you cannot place a project you cannot see
    assert_eq!(a.err(&bo, "workspaces.place", json!({"project": q, "workspace": "default"})).category, Category::NotFound);
}

#[test]
fn leaving_or_deleting_a_project_clears_its_placement_and_the_plugin_can_be_off() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Shared");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let w = a.ok(&bo, "workspaces.create", json!({"name": "Mine"}))["id"].as_str().unwrap().to_string();
    a.ok(&bo, "workspaces.place", json!({"project": p, "workspace": w}));
    a.ok(&bo, "projects.leave", json!({"project": p}));
    a.settle();
    assert!(a.ok(&bo, "workspaces.list", json!({}))["placements"].as_array().unwrap().is_empty());
    let path = temp_db();
    let core = start_file(&path, &["workspaces"]).unwrap_or_else(|p| panic!("{p:#?}"));
    assert!(core.call_as(&al, "workspaces.list", json!({}), None).is_err());
}

// ---- search, versions, recurrence, page history, files (ADR 0025) ---------------------------------------------------

fn rich(text: &str) -> Value {
    json!({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
}

#[test]
fn search_finds_what_you_can_see_best_match_first() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Alpha");
    let secret = a.project(&bo, "Bob only");
    a.task(&al, &p, "Buy oat milk");
    a.ok(&al, "tasks.create", json!({"project": p, "title": "Errands", "description": rich("remember the MILK and eggs")}));
    a.task(&bo, &secret, "milk run for bob");
    a.ok(&al, "knowledge.create", json!({"project": p, "title": "Milk supplier notes", "body": rich("prices of milk")}));
    a.ok(&al, "pages.create", json!({"title": "Shopping", "body": rich("milk, bread")}));
    let found = a.ok(&al, "search.query", json!({"q": "milk"}));
    let items = found["items"].as_array().unwrap();
    let titles: Vec<&str> = items.iter().map(|x| x["title"].as_str().unwrap()).collect();
    assert_eq!(items.len(), 4, "{titles:?}");
    assert!(!titles.contains(&"milk run for bob"), "never another person's project");
    assert_eq!(titles[0], "Milk supplier notes", "title hit plus body hits ranks first");
    assert!(items.iter().any(|x| x["kind"] == "page") && items.iter().any(|x| x["kind"] == "knowledge") && items.iter().any(|x| x["kind"] == "task"));
    let snippet = items.iter().find(|x| x["title"] == "Errands").unwrap()["snippet"].as_str().unwrap().to_lowercase();
    assert!(snippet.contains("milk"));
    // every word must match; kinds narrow it
    assert!(a.ok(&al, "search.query", json!({"q": "milk zebra"}))["items"].as_array().unwrap().is_empty());
    assert_eq!(a.ok(&al, "search.query", json!({"q": "milk", "kinds": ["page"]}))["items"].as_array().unwrap().len(), 1);
    // bob's private page is invisible to alice
    a.ok(&bo, "pages.create", json!({"title": "Bob diary", "body": rich("milk")}));
    assert_eq!(a.ok(&al, "search.query", json!({"q": "milk"}))["items"].as_array().unwrap().len(), 4);
    assert_eq!(a.err(&al, "search.query", json!({"q": "m"})).category, Category::Invalid);
}

#[test]
fn a_page_keeps_pictures_of_itself_and_a_restore_can_be_undone() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Docs");
    let page = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Plan", "body": rich("one")}));
    let id = page["id"].as_str().unwrap().to_string();
    a.clock.advance(1000);
    a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "body": rich("two")}));
    a.clock.advance(1000);
    a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "body": rich("three")}));
    let v = a.ok(&al, "knowledge.versions", json!({"project": p, "id": id}));
    assert_eq!(v["versions"].as_array().unwrap().len(), 1, "one picture per editing spell");
    assert_eq!(v["versions"][0]["text"], "one");
    a.clock.advance(11 * 60 * 1000);
    a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "body": rich("four")}));
    let v = a.ok(&al, "knowledge.versions", json!({"project": p, "id": id}));
    let list = v["versions"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["text"], "three", "newest first");
    let vid = list[1]["id"].as_str().unwrap().to_string();
    assert_eq!(a.ok(&al, "knowledge.version", json!({"project": p, "id": id, "version": vid}))["body"], rich("one"));
    a.clock.advance(1000);
    let back = a.ok(&al, "knowledge.restore", json!({"project": p, "id": id, "version": vid}));
    assert_eq!(back["body"], rich("one"));
    let v = a.ok(&al, "knowledge.versions", json!({"project": p, "id": id}));
    assert_eq!(v["versions"][0]["text"], "four", "the page as it was before the restore is kept");
    // a viewer reads versions but cannot restore; a stranger sees nothing
    a.ok(&al, "projects.share", json!({"project": p, "subject": "vera", "level": "viewer"}));
    let vera = viewer("vera");
    assert_eq!(a.ok(&vera, "knowledge.versions", json!({"project": p, "id": id}))["versions"].as_array().unwrap().len(), 3);
    assert_eq!(a.err(&vera, "knowledge.restore", json!({"project": p, "id": id, "version": vid})).category, Category::Denied);
    assert_eq!(a.err(&who("mallory"), "knowledge.versions", json!({"project": p, "id": id})).category, Category::NotFound);
    // personal pages keep versions too, and deleting the page deletes them
    let n = a.ok(&al, "pages.create", json!({"title": "N", "body": rich("a")}));
    a.ok(&al, "pages.update", json!({"id": n["id"], "body": rich("b")}));
    assert_eq!(a.ok(&al, "pages.versions", json!({"id": n["id"]}))["versions"].as_array().unwrap().len(), 1);
    a.ok(&al, "knowledge.delete", json!({"project": p, "id": id}));
    assert_eq!(a.err(&al, "knowledge.versions", json!({"project": p, "id": id})).category, Category::NotFound);
}

#[test]
fn the_history_records_page_changes_but_autosave_is_one_entry() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Docs");
    let page = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Plan"}));
    let id = page["id"].as_str().unwrap().to_string();
    for n in 0..5 {
        a.clock.advance(2000);
        a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "body": rich(&format!("v{n}"))}));
    }
    a.ok(&al, "pages.create", json!({"title": "Private"}));
    a.settle();
    let h = a.ok(&al, "audit.list", json!({"project": p}));
    let kinds: Vec<&str> = h["entries"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds.iter().filter(|k| **k == "pages.updated").count(), 1, "{kinds:?}");
    assert!(kinds.contains(&"pages.created"));
    assert_eq!(kinds.iter().filter(|k| **k == "pages.created").count(), 1, "a private page is never recorded: {kinds:?}");
}

#[test]
fn a_repeating_task_leaves_the_next_one_when_it_is_finished_and_only_once() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Home");
    let pr = a.ok(&al, "projects.get", json!({"project": p}));
    let (first, last) = (pr["statuses"][0]["id"].as_str().unwrap().to_string(), pr["statuses"][2]["id"].as_str().unwrap().to_string());
    let t = a.ok(&al, "tasks.create", json!({"project": p, "title": "Water plants", "due": "2023-11-20", "priority": 4,
        "repeat": {"every": 1, "unit": "week"}, "labels": []}));
    assert_eq!(t["repeat"]["unit"], "week");
    let id = t["id"].as_str().unwrap().to_string();
    a.ok(&al, "tasks.move", json!({"project": p, "id": id, "status": last}));
    let open = a.ok(&al, "tasks.list", json!({"project": p, "status": first}))["tasks"].clone();
    assert_eq!(open.as_array().unwrap().len(), 1);
    assert_eq!(open[0]["title"], "Water plants");
    assert_eq!(open[0]["due"], "2023-11-27", "a week after the old due date, which is still ahead");
    assert_eq!(open[0]["priority"], 4);
    assert_eq!(open[0]["repeat"]["every"], 1);
    // finishing it again (move out and back) does not make a second copy
    a.ok(&al, "tasks.move", json!({"project": p, "id": id, "status": first}));
    a.ok(&al, "tasks.update", json!({"project": p, "id": id, "status": last}));
    assert_eq!(a.ok(&al, "tasks.list", json!({"project": p, "status": first}))["tasks"].as_array().unwrap().len(), 1, "only the one copy, finishing again made no second");
    // the new one repeats too, and a monthly step lands on the month's last day when needed
    let nid = open[0]["id"].as_str().unwrap().to_string();
    a.ok(&al, "tasks.update", json!({"project": p, "id": nid, "due": "2023-01-31", "repeat": {"every": 1, "unit": "month"}}));
    a.ok(&al, "tasks.update", json!({"project": p, "id": nid, "status": last}));
    let dues: Vec<String> = a.ok(&al, "tasks.list", json!({"project": p, "status": first}))["tasks"].as_array().unwrap().iter().filter_map(|t| t["due"].as_str().map(String::from)).collect();
    assert!(dues.contains(&"2023-12-14".to_string()) || dues.iter().any(|d| d.starts_with("2023-12")), "{dues:?}");
    // a bad repeat is refused
    assert!(a.call(&al, "tasks.create", json!({"project": p, "title": "x", "repeat": {"every": 0, "unit": "day"}})).is_err());
    assert!(a.call(&al, "tasks.create", json!({"project": p, "title": "x", "repeat": {"every": 2, "unit": "year"}})).is_err());
}

#[test]
fn intervals_step_over_short_months() {
    assert_eq!(add_interval_for_test("2024-01-31", 1, "month"), "2024-02-29");
    assert_eq!(add_interval_for_test("2023-12-15", 2, "month"), "2024-02-15");
    assert_eq!(add_interval_for_test("2023-12-30", 1, "day"), "2023-12-31");
    assert_eq!(add_interval_for_test("2023-12-30", 2, "week"), "2024-01-13");
}
fn add_interval_for_test(d: &str, n: i64, u: &str) -> String {
    madar_plugins::add_interval(d, n, u)
}

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

#[test]
fn files_are_sniffed_limited_and_only_shown_to_who_may_see_them() {
    let a = app();
    let (al, bo, vera) = (who("alice"), who("bob"), viewer("vera"));
    let p = a.project(&al, "Shots");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    a.ok(&al, "projects.share", json!({"project": p, "subject": "vera", "level": "viewer"}));
    let up = a.ok(&bo, "files.upload", json!({"name": "../../etc/shot.png", "data": PNG, "project": p}));
    assert_eq!(up["type"], "image/png");
    assert_eq!(up["name"], "shot.png", "a path in the name is dropped");
    let id = up["id"].as_str().unwrap().to_string();
    assert_eq!(up["url"], format!("/files/{id}"));
    assert_eq!(a.ok(&al, "files.download", json!({"id": id}))["data"], PNG, "members read it");
    assert_eq!(a.ok(&vera, "files.download", json!({"id": id}))["type"], "image/png");
    assert_eq!(a.err(&who("mallory"), "files.download", json!({"id": id})).category, Category::NotFound);
    // a viewer cannot add to the project; the declared name cannot change what a file is
    assert_eq!(a.err(&vera, "files.upload", json!({"name": "x.png", "data": PNG, "project": p})).category, Category::Denied);
    use base64::{engine::general_purpose::STANDARD, Engine};
    let script = STANDARD.encode(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    let svg = a.ok(&al, "files.upload", json!({"name": "evil.png", "data": script}));
    assert_eq!(svg["type"], "text/plain", "markup is never served as an image");
    let bin = STANDARD.encode([0u8, 1, 2, 3, 255]);
    assert_eq!(a.err(&al, "files.upload", json!({"name": "a.bin", "data": bin})).reason.as_deref(), Some("files.bad_type"));
    let big = STANDARD.encode(vec![b'a'; 4 * 1024 * 1024 + 1]);
    assert_eq!(a.err(&al, "files.upload", json!({"name": "big.txt", "data": big})).reason.as_deref(), Some("files.too_big"));
    assert_eq!(a.err(&al, "files.upload", json!({"name": "x", "data": "***"})).category, Category::Invalid);
    // a personal file is its uploader's alone
    let mine = a.ok(&al, "files.upload", json!({"name": "me.png", "data": PNG}));
    assert_eq!(a.err(&bo, "files.download", json!({"id": mine["id"]})).category, Category::NotFound);
    // only the uploader or a project owner removes it
    assert_eq!(a.err(&vera, "files.remove", json!({"id": id})).category, Category::NotFound);
    a.ok(&al, "files.remove", json!({"id": id}));
    assert_eq!(a.err(&al, "files.download", json!({"id": id})).category, Category::NotFound);
}

#[test]
fn search_and_files_can_be_switched_off_without_touching_the_rest() {
    let mut p = profile_test(&[]);
    p.enabled.retain(|e| e != "@madar/search" && e != "@madar/files" && e != "@madar/files-db");
    p.grants.remove("search");
    p.grants.remove("files");
    let dist = distribution_with(p, vec![Arc::new(TestClock(FixedClock::at(1_700_000_000_000))), Arc::new(TestIds)]);
    let core = Core::start(&dist).unwrap_or_else(|p| panic!("{p:#?}"));
    let al = who("alice");
    let t = core.call_as(&al, "projects.create", json!({"name": "P"}), None).unwrap().output;
    core.call_as(&al, "tasks.create", json!({"project": t["id"], "title": "still works"}), None).unwrap();
    assert!(core.call_as(&al, "search.query", json!({"q": "still"}), None).is_err());
}

fn image_doc(urls: &[&str]) -> Value {
    let mut c: Vec<Value> = vec![json!({"type": "paragraph"})];
    for u in urls {
        c.push(json!({"type": "image", "attrs": {"src": u, "alt": ""}}));
    }
    json!({"type": "doc", "content": c})
}

#[test]
fn deleting_a_page_deletes_the_files_only_it_showed() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let p = a.project(&al, "Shots");
    let q = a.project(&al, "Other");
    a.ok(&al, "projects.share", json!({"project": p, "subject": "bob", "level": "editor"}));
    let up = |who: &Identity, project: Option<&str>| {
        let mut i = json!({"name": "s.png", "data": PNG});
        if let Some(pr) = project { i["project"] = json!(pr); }
        a.ok(who, "files.upload", i)["id"].as_str().unwrap().to_string()
    };
    let (only, shared, elsewhere, stray) = (up(&bo, Some(&p)), up(&bo, Some(&p)), up(&al, Some(&q)), up(&bo, Some(&p)));
    let (u_only, u_shared, u_else) = (format!("/files/{only}"), format!("/files/{shared}"), format!("/files/{elsewhere}"));
    let one = a.ok(&bo, "knowledge.create", json!({"project": p, "title": "One", "body": image_doc(&[&u_only, &u_shared, &u_else, "https://example.com/x.png"])}))["id"].as_str().unwrap().to_string();
    let two = a.ok(&bo, "knowledge.create", json!({"project": p, "title": "Two", "body": image_doc(&[&u_shared])}))["id"].as_str().unwrap().to_string();
    a.settle();
    // editing the picture out does not delete it: an undo or a restored version can bring it back
    a.ok(&bo, "knowledge.update", json!({"project": p, "id": two, "body": image_doc(&[])}));
    a.settle();
    assert!(a.ok(&bo, "files.info", json!({"id": shared}))["id"].is_string());
    a.ok(&bo, "knowledge.update", json!({"project": p, "id": two, "body": image_doc(&[&u_shared])}));
    a.settle();
    a.ok(&bo, "knowledge.delete", json!({"project": p, "id": one}));
    a.settle();
    assert_eq!(a.err(&bo, "files.info", json!({"id": only})).category, Category::NotFound, "only that page showed it");
    assert!(a.ok(&bo, "files.info", json!({"id": shared}))["id"].is_string(), "another page still shows it");
    assert!(a.ok(&al, "files.info", json!({"id": elsewhere}))["id"].is_string(), "a file from another project is never touched");
    assert!(a.ok(&bo, "files.info", json!({"id": stray}))["id"].is_string());
    a.ok(&bo, "knowledge.delete", json!({"project": p, "id": two}));
    a.settle();
    assert_eq!(a.err(&bo, "files.download", json!({"id": shared})).category, Category::NotFound, "the last page that showed it is gone");
    // the bytes went too, not only the record
    assert_eq!(a.err(&al, "files.info", json!({"id": shared})).category, Category::NotFound);
}

#[test]
fn deleting_a_note_deletes_its_files_and_the_sweep_removes_strays() {
    let a = app();
    let al = who("alice");
    let f = a.ok(&al, "files.upload", json!({"name": "n.png", "data": PNG}))["id"].as_str().unwrap().to_string();
    let n = a.ok(&al, "pages.create", json!({"title": "Diary", "body": image_doc(&[&format!("/files/{f}")])}))["id"].as_str().unwrap().to_string();
    let stray = a.ok(&al, "files.upload", json!({"name": "s.png", "data": PNG}))["id"].as_str().unwrap().to_string();
    a.settle();
    a.ok(&al, "pages.delete", json!({"id": n}));
    a.settle();
    assert_eq!(a.err(&al, "files.info", json!({"id": f})).category, Category::NotFound);
    // a stray is young: kept; after a day it goes
    assert_eq!(a.ok(&al, "files.sweep", json!({}))["removed"], 0);
    a.clock.advance(2 * 86_400_000);
    assert_eq!(a.ok(&al, "files.sweep", json!({}))["removed"], 1);
    assert_eq!(a.err(&al, "files.info", json!({"id": stray})).category, Category::NotFound);
}

#[test]
fn deleting_a_project_deletes_its_uploads() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Gone");
    let f = a.ok(&al, "files.upload", json!({"name": "g.png", "data": PNG, "project": p}))["id"].as_str().unwrap().to_string();
    let mine = a.ok(&al, "files.upload", json!({"name": "m.png", "data": PNG}))["id"].as_str().unwrap().to_string();
    a.ok(&al, "projects.delete", json!({"project": p}));
    a.settle();
    assert_eq!(a.err(&al, "files.info", json!({"id": f})).category, Category::NotFound);
    assert!(a.ok(&al, "files.info", json!({"id": mine}))["id"].is_string());
}

#[test]
fn a_person_changes_the_look_with_checked_overrides_and_only_they_are_told() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let schema = a.ok(&al, "appearance.schema", json!({}));
    assert_eq!(schema["version"], "theme/1");
    let keys: Vec<&str> = schema["items"].as_array().unwrap().iter().map(|i| i["key"].as_str().unwrap()).collect();
    for k in ["accent", "r", "rcard", "rbtn", "rchip", "material", "sig.r_rail", "texture"] {
        assert!(keys.contains(&k), "{k} is a token: {keys:?}");
    }
    assert_eq!(a.ok(&al, "appearance.get", json!({}))["overrides"], json!({}));
    let (ca, cb) = (a.core.pulse_now().unwrap(), a.core.pulse_now().unwrap());
    let saved = a.ok(&al, "appearance.save", json!({"overrides": {"r": 5, "rbtn": 5, "rcard": "auto", "dark:accent": "#D9D9D9", "sig.r_rail": true}}));
    assert_eq!(saved["overrides"]["dark:accent"], "#d9d9d9", "colours are stored in lower case");
    assert_eq!(a.ok(&al, "appearance.get", json!({}))["overrides"]["r"], 5);
    assert_eq!(a.ok(&bo, "appearance.get", json!({}))["overrides"], json!({}), "only your own");
    assert_eq!(a.core.pulse(&al, Some(&ca), 10).unwrap().events.len(), 1);
    assert!(a.core.pulse(&bo, Some(&cb), 10).unwrap().events.is_empty());
    // a bad value changes nothing
    for bad in [json!({"r": 99}), json!({"dark:accent": "red"}), json!({"nope": 1}), json!({"font": "Comic Sans"})] {
        assert_eq!(a.err(&al, "appearance.save", json!({"overrides": bad.clone()})).category, Category::Invalid, "{bad}");
    }
    assert_eq!(a.ok(&al, "appearance.get", json!({}))["overrides"]["r"], 5);
    // saving replaces; reset returns to the preset
    a.ok(&al, "appearance.save", json!({"overrides": {"gap": 4}}));
    assert_eq!(a.ok(&al, "appearance.get", json!({}))["overrides"], json!({"gap": 4}));
    a.ok(&al, "appearance.reset", json!({}));
    assert_eq!(a.ok(&al, "appearance.get", json!({}))["overrides"], json!({}));
}

#[test]
fn projects_get_a_latin_key_even_from_an_arabic_name_and_keys_stay_unique() {
    let a = app();
    let al = who("alice");
    let one = a.ok(&al, "projects.create", json!({"name": "madar"}));
    assert_eq!(one["key"], "MDR");
    let two = a.ok(&al, "projects.create", json!({"name": "مدار"}));
    assert_eq!(two["key"], "MDR2", "a clash adds a number, and the Arabic name still gives Latin letters");
    let three = a.ok(&al, "projects.create", json!({"name": "خطة الإطلاق"}));
    assert_eq!(three["key"], "KA");
    assert!(three["key"].as_str().unwrap().is_ascii());
    // a chosen key must be well formed and free
    assert_eq!(a.ok(&al, "projects.create", json!({"name": "x", "key": "OPS"}))["key"], "OPS");
    assert_eq!(a.err(&al, "projects.create", json!({"name": "y", "key": "OPS"})).category, Category::Conflict);
    for bad in ["o", "ops", "1AB", "TOOLONGKEY", "مدار"] {
        assert_eq!(a.err(&al, "projects.create", json!({"name": "z", "key": bad})).category, Category::Invalid, "{bad}");
    }
    // renaming does not change the key; editing the key does, and cannot take another project's
    let id = one["id"].as_str().unwrap();
    assert_eq!(a.ok(&al, "projects.update", json!({"project": id, "name": "Orbit"}))["key"], "MDR");
    assert_eq!(a.ok(&al, "projects.update", json!({"project": id, "key": "ORB"}))["key"], "ORB");
    assert!(a.call(&al, "projects.update", json!({"project": id, "key": "OPS"})).is_err());
    assert_eq!(a.ok(&al, "projects.get", json!({"project": id}))["key"], "ORB");
}

#[test]
fn tasks_and_pages_are_numbered_per_project_and_numbers_are_never_reused() {
    let a = app();
    let al = who("alice");
    let (p, q) = (a.project(&al, "alpha"), a.project(&al, "beta"));
    let t1 = a.task(&al, &p, "one");
    let t2 = a.task(&al, &p, "two");
    let q1 = a.task(&al, &q, "other project");
    assert_eq!((t1["number"].clone(), t2["number"].clone(), q1["number"].clone()), (json!(1), json!(2), json!(1)));
    let sub = a.ok(&al, "tasks.create", json!({"project": p, "title": "a subtask", "parent": t1["id"]}));
    assert_eq!(sub["number"], 3, "subtasks count too");
    // deleting the last one does not hand its number out again
    a.ok(&al, "tasks.remove", json!({"project": p, "id": sub["id"]}));
    assert_eq!(a.task(&al, &p, "three")["number"], 4);
    assert_eq!(a.ok(&al, "tasks.get", json!({"project": p, "id": t2["id"]}))["number"], 2);
    // a repeat leaves a new number too
    let r = a.ok(&al, "tasks.create", json!({"project": p, "title": "weekly", "due": "2023-01-01", "repeat": {"every": 1, "unit": "week"}}));
    a.ok(&al, "tasks.move", json!({"project": p, "id": r["id"], "status": "done"}));
    let numbers: Vec<i64> = a.ok(&al, "tasks.list", json!({"project": p, "limit": 100}))["tasks"].as_array().unwrap().iter().map(|t| t["number"].as_i64().unwrap()).collect();
    let mut sorted = numbers.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(numbers.len(), 5, "the repeat left its next task: {numbers:?}");
    assert_eq!(sorted.len(), numbers.len(), "no number is used twice: {numbers:?}");
    // pages: numbered inside a project, none for personal pages
    let pg = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Plan"}));
    let pg2 = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Notes"}));
    assert_eq!((pg["number"].clone(), pg2["number"].clone()), (json!(1), json!(2)));
    assert!(a.ok(&al, "pages.create", json!({"title": "mine"}))["number"].is_null());
}

#[test]
fn a_page_remembers_how_it_is_shown_and_refuses_anything_else() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "docs");
    let pg = a.ok(&al, "knowledge.create", json!({"project": p, "title": "Guide"}));
    assert_eq!(pg["settings"], json!({}));
    let id = pg["id"].as_str().unwrap();
    let out = a.ok(&al, "knowledge.update", json!({"project": p, "id": id, "settings": {"font": "serif", "size": 18, "width": "wide"}}));
    assert_eq!(out["settings"], json!({"font": "serif", "size": 18, "width": "wide"}));
    assert_eq!(a.ok(&al, "knowledge.get", json!({"project": p, "id": id}))["settings"]["size"], 18);
    for bad in [json!({"font": "comic"}), json!({"size": 99}), json!({"width": "huge"}), json!({"colour": "red"}), json!("x")] {
        assert_eq!(a.err(&al, "knowledge.update", json!({"project": p, "id": id, "settings": bad.clone()})).category, Category::Invalid, "{bad}");
    }
    // personal pages keep settings too
    let n = a.ok(&al, "pages.create", json!({"title": "mine"}));
    assert_eq!(a.ok(&al, "pages.update", json!({"id": n["id"], "settings": {"font": "mono"}}))["settings"]["font"], "mono");
}

#[test]
fn a_postgres_url_selects_the_postgres_adapter_and_a_path_selects_sqlite() {
    let pg = profile_server("postgres://u:p@db/madar", json!([]));
    assert!(pg.enabled.iter().any(|e| e == "@nuah/db-postgres") && !pg.enabled.iter().any(|e| e == "@nuah/db-sqlite"));
    assert_eq!(pg.settings["@nuah/db-postgres"], json!({"url": "postgres://u:p@db/madar"}));
    let lite = profile_server("/data/madar.db", json!([]));
    assert!(lite.enabled.iter().any(|e| e == "@nuah/db-sqlite") && !lite.enabled.iter().any(|e| e == "@nuah/db-postgres"));
    assert_eq!(lite.settings["@nuah/db-sqlite"], json!({"path": "/data/madar.db"}));
    assert!(catalog().0.iter().any(|p| p.manifest().id == "@nuah/db-postgres"));
}
