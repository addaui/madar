use nuah_adapters::*;
use nuah_kernel::*;
use nuah_madar::*;
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
        p.enabled.retain(|e| e != "db-memory");
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
    assert_eq!(a.ok(&al, "prefs.get", json!({}))["theme"], "paper");
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
    assert_eq!(kinds["notify-inbox"], "provider");
    assert_eq!(kinds["theme-ink"], "theme");
    assert_eq!(kinds["db-memory"], "adapter");
    assert_eq!(kinds["tasks"], "feature");
    assert_eq!(d["themes"].as_array().unwrap().len(), 2);
    assert_eq!(d["extension_points"]["notify.channel"]["providers"], json!(["notify-inbox"]));
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
    p.enabled.retain(|e| !["db-sqlite", "clock-system", "ids-random"].contains(&e.as_str()));
    p.enabled.extend(["db-memory", "clock-fixed", "ids-sequential"].map(String::from));
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
    assert_eq!(call(Some(&token), "auth.who", json!({})).unwrap().output["subject"], "alice");
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
    p.enabled.retain(|e| !without.contains(&e.as_str()));
    p.grants.retain(|k, _| !without.contains(&k.as_str()));
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
    Arc::new(Pin(json!({"id": "pin", "version": "0.1.0", "name": "Pin", "namespaces": ["pin"],
        "requires": {"plugins": ["tasks"]}, "slots": slots})))
}

fn slot_problems(slots: Value) -> Vec<Problem> {
    let mut p = profile_embedded(":memory:");
    p.enabled.push("pin".into());
    Core::check(&distribution_with(p, vec![pin_with(slots)]))
}

fn archive_item() -> Value {
    json!({"slot": "task.actions", "id": "pin.archive", "label": {"en": "Archive now", "ar": "أرشفة"},
        "operation": "tasks.update", "args": {"project": "$project.id", "id": "$task.id", "archived": true}})
}

#[test]
fn a_plugin_adds_a_button_by_declaring_it_and_nobody_else_changes() {
    let mut p = profile_test(&[]);
    p.enabled.push("pin".into());
    let dist = distribution_with(p, vec![pin_with(json!([archive_item()])), Arc::new(TestClock(FixedClock::at(1_700_000_000_000))), Arc::new(TestIds)]);
    let core = Core::start(&dist).unwrap_or_else(|p| panic!("{p:#?}"));
    let d = core.describe(&who("alice"));
    let items: Vec<&Value> = d["slots"].as_array().unwrap().iter().collect();
    // Madar's export item and the new one, in their Slots, each in the caller's reach.
    assert!(items.iter().any(|i| i["id"] == "export.project" && i["slot"] == "project.actions"));
    let mine = items.iter().find(|i| i["id"] == "pin.archive").expect("the new item is listed");
    assert_eq!((mine["slot"].as_str(), mine["operation"].as_str(), mine["plugin"].as_str()), (Some("task.actions"), Some("tasks.update"), Some("pin")));
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
    p.enabled.retain(|e| e != "policy-roles");
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

// ---- pages, notes, links, editor (ADR 0019, 0020, 0022) ---------------------------------------------------

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
    let root = a.ok(&al, "pages.create", json!({"project": p, "title": "Guide"}));
    let (r, ) = (root["id"].as_str().unwrap().to_string(),);
    let b = a.ok(&bo, "pages.create", json!({"project": p, "title": "Setup", "parent": r}))["id"].as_str().unwrap().to_string();
    let c = a.ok(&bo, "pages.create", json!({"project": p, "title": "Usage", "parent": r}))["id"].as_str().unwrap().to_string();
    let titles = |who: &Identity| -> Vec<String> { a.ok(who, "pages.list", json!({"project": p}))["pages"].as_array().unwrap().iter().map(|x| x["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(titles(&ve), ["Guide", "Setup", "Usage"]);
    // the viewer reads but does not write; a stranger does not even know the project
    assert_eq!(a.ok(&ve, "pages.get", json!({"project": p, "id": b}))["title"], "Setup");
    assert_eq!(a.err(&ve, "pages.create", json!({"project": p, "title": "No"})).category, Category::Denied);
    assert_eq!(a.err(&mal, "pages.list", json!({"project": p})).category, Category::NotFound);
    // a page of another project is not reachable through this one
    let q = a.project(&al, "Other");
    assert_eq!(a.err(&al, "pages.get", json!({"project": q, "id": b})).category, Category::NotFound);
    // reorder: Usage before Setup
    a.ok(&bo, "pages.move", json!({"project": p, "id": c, "parent": r, "before": b}));
    let kids: Vec<String> = a.ok(&al, "pages.list", json!({"project": p}))["pages"].as_array().unwrap().iter().filter(|x| x["parent"] == r.as_str()).map(|x| x["title"].as_str().unwrap().to_string()).collect();
    assert_eq!(kids, ["Usage", "Setup"]);
    // a page cannot go under itself or its own child
    assert_eq!(a.err(&al, "pages.move", json!({"project": p, "id": r, "parent": b})).category, Category::Invalid);
    assert_eq!(a.err(&al, "pages.move", json!({"project": p, "id": r, "parent": r})).category, Category::Invalid);
    // move under another page, then delete the branch
    a.ok(&al, "pages.move", json!({"project": p, "id": b, "parent": c}));
    let gone = a.ok(&al, "pages.delete", json!({"project": p, "id": c}));
    assert_eq!(gone["removed"], 2);
    assert_eq!(titles(&al), ["Guide"]);
    // search by title
    a.ok(&al, "pages.create", json!({"project": p, "title": "Release notes"}));
    assert_eq!(a.ok(&al, "pages.search", json!({"project": p, "q": "RELEASE"}))["pages"].as_array().unwrap().len(), 1);
}

#[test]
fn pages_nest_to_a_limit_and_an_edit_of_a_stale_copy_is_a_conflict() {
    let a = app();
    let al = who("alice");
    let p = a.project(&al, "Deep");
    let mut parent = Value::Null;
    for n in 1..=12 {
        let r = a.ok(&al, "pages.create", json!({"project": p, "title": format!("L{n}"), "parent": parent}));
        parent = r["id"].clone();
    }
    assert_eq!(a.err(&al, "pages.create", json!({"project": p, "title": "L13", "parent": parent})).reason.as_deref(), Some("pages.too_deep"));
    let page = a.ok(&al, "pages.create", json!({"project": p, "title": "Edit me"}));
    let (id, rev) = (page["id"].as_str().unwrap(), page["rev"].as_u64().unwrap());
    a.ok(&al, "pages.update", json!({"project": p, "id": id, "title": "First", "expected_rev": rev}));
    let e = a.err(&al, "pages.update", json!({"project": p, "id": id, "title": "Second", "expected_rev": rev}));
    assert_eq!((e.category, e.reason.as_deref()), (Category::Conflict, Some("pages.stale_revision")));
    // a body that is not a document is refused before anything is stored
    assert_eq!(a.err(&al, "pages.update", json!({"project": p, "id": id, "body": {"type": "paragraph"}})).category, Category::Invalid);
}

#[test]
fn notes_are_private_to_their_owner() {
    let a = app();
    let (al, bo) = (who("alice"), who("bob"));
    let n = a.ok(&al, "notes.create", json!({"title": "Diary", "body": doc_with("secret", &[])}));
    let id = n["id"].as_str().unwrap();
    assert_eq!(a.ok(&al, "notes.get", json!({"id": id}))["title"], "Diary");
    assert_eq!(a.err(&bo, "notes.get", json!({"id": id})).category, Category::NotFound);
    assert!(a.ok(&bo, "notes.list", json!({}))["pages"].as_array().unwrap().is_empty());
    assert_eq!(a.err(&bo, "notes.update", json!({"id": id, "title": "mine now"})).category, Category::NotFound);
    // a note never shows up as a project page, and the other way round
    let p = a.project(&al, "P");
    assert_eq!(a.err(&al, "pages.get", json!({"project": p, "id": id})).category, Category::NotFound);
    // nothing about a note reaches another person's live feed
    let (cb, ) = (a.core.pulse_now().unwrap(), );
    a.ok(&al, "notes.update", json!({"id": id, "title": "Journal"}));
    assert!(a.core.pulse(&bo, Some(&cb), 10).unwrap().events.is_empty());
}

#[test]
fn links_remember_what_refers_to_what_and_follow_edits() {
    let a = app();
    let (al, mal) = (who("alice"), who("mallory"));
    let p = a.project(&al, "Wiki");
    let t = a.task(&al, &p, "Fix login");
    let target = a.ok(&al, "pages.create", json!({"project": p, "title": "Design"}))["id"].as_str().unwrap().to_string();
    let t_id = t["id"].as_str().unwrap().to_string();
    let src = a.ok(&al, "pages.create", json!({"project": p, "title": "Plan", "body": doc_with("see", &[("pages.page", &target), ("tasks.task", &t_id)])}));
    let src_id = src["id"].as_str().unwrap().to_string();
    a.settle();
    let to = |kind: &str, id: &str| -> Vec<String> { a.ok(&al, "links.to", json!({"project": p, "kind": kind, "id": id}))["links"].as_array().unwrap().iter().map(|l| l["title"].as_str().unwrap().to_string()).collect() };
    assert_eq!(to("pages.page", &target), ["Plan"]);
    assert_eq!(to("tasks.task", &t_id), ["Plan"]);
    // editing the source to drop one reference removes that link only
    a.ok(&al, "pages.update", json!({"project": p, "id": src_id, "body": doc_with("see", &[("pages.page", &target)])}));
    a.settle();
    assert_eq!(to("pages.page", &target), ["Plan"]);
    assert!(to("tasks.task", &t_id).is_empty());
    // deleting the source removes the rest
    a.ok(&al, "pages.delete", json!({"project": p, "id": src_id}));
    a.settle();
    assert!(to("pages.page", &target).is_empty());
    // backlinks are answered only to people who can see the project
    assert_eq!(a.err(&mal, "links.to", json!({"project": p, "kind": "pages.page", "id": target})).category, Category::NotFound);
    // notes: your own, and only yours
    let n = a.ok(&al, "notes.create", json!({"title": "Idea", "body": doc_with("x", &[("pages.page", "elsewhere")])}));
    a.settle();
    let mine = a.ok(&al, "links.mine", json!({"kind": "pages.page", "id": "elsewhere"}));
    assert_eq!(mine["links"][0]["from"]["id"], n["id"]);
    assert!(a.ok(&mal, "links.mine", json!({"kind": "pages.page", "id": "elsewhere"}))["links"].as_array().unwrap().is_empty());
}

#[test]
fn the_editor_offers_the_blocks_plugins_declare() {
    let a = app();
    let blocks = a.ok(&who("alice"), "editor.blocks", json!({}));
    let ids: Vec<&str> = blocks["blocks"].as_array().unwrap().iter().map(|b| b["id"].as_str().unwrap()).collect();
    for want in ["heading1", "codeBlock", "taskList", "toggle", "calloutWarning", "image", "youtube", "entityRef"] {
        assert!(ids.contains(&want), "{want} in {ids:?}");
    }
    assert_eq!(blocks["blocks"][0]["plugin"], "editor-basic");
}

#[test]
fn switching_pages_off_keeps_its_data_and_the_rest_runs() {
    let path = temp_db();
    let al = who("alice");
    let core = start_file(&path, &[]).unwrap();
    let p = core.call_as(&al, "projects.create", json!({"name": "Home"}), None).unwrap().output["id"].as_str().unwrap().to_string();
    core.call_as(&al, "pages.create", json!({"project": p, "title": "Kept"}), None).unwrap();
    drop(core);
    let core = start_file(&path, &["pages", "links"]).unwrap_or_else(|p| panic!("{p:#?}"));
    assert!(core.call_as(&al, "pages.list", json!({"project": p}), None).is_err());
    core.call_as(&al, "tasks.create", json!({"project": p, "title": "still fine"}), None).unwrap();
    drop(core);
    let core = start_file(&path, &[]).unwrap();
    assert_eq!(core.call_as(&al, "pages.list", json!({"project": p}), None).unwrap().output["pages"][0]["title"], "Kept");
}
