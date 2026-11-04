use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};
use std::collections::HashMap;

fn core() -> Core {
    start(memory_for_tests()).unwrap()
}

fn call_as(core: &Core, token: Option<&str>, op: &str, input: Value) -> Result<Value> {
    core.call(CallRequest { credential: token.map(String::from), op: op.into(), input, ..Default::default() }).map(|r| r.data)
}

fn call(core: &Core, op: &str, input: Value) -> Result<Value> {
    call_as(core, None, op, input)
}

fn ok(core: &Core, op: &str, input: Value) -> Value {
    call(core, op, input).unwrap_or_else(|e| panic!("{op} failed: {e}"))
}

fn err(core: &Core, op: &str, input: Value) -> LinkError {
    call(core, op, input).expect_err(&format!("{op} should fail"))
}

fn project(core: &Core) -> String {
    ok(core, "projects.create", json!({"name": "Home"}))["id"].as_str().unwrap().to_string()
}

fn server_dist() -> Distribution {
    let mut enabled: Vec<String> = ["std-fixed", "adapter-memory", "auth-token", "policy-roles", "tasks", "audit", "quota", "prefs", "export"]
        .iter().map(|s| s.to_string()).collect();
    enabled.sort();
    Distribution {
        name: "server".into(),
        catalog: catalog(),
        enabled,
        bindings: HashMap::new(),
        settings: HashMap::from([
            ("auth-token".to_string(), json!({"tokens": {
                "t-alice": {"subject": "alice", "display": "Alice", "roles": ["owner"]},
                "t-bob": {"subject": "bob", "display": "Bob", "roles": ["member"]},
                "t-view": {"subject": "alice", "display": "Alice (read only)", "roles": ["viewer"]}}})),
            ("quota".to_string(), json!({"max_tasks": 3})),
        ]),
    }
}

// ---------- domain rules ----------

#[test]
fn projects_get_madar_default_statuses() {
    let c = core();
    let p = ok(&c, "projects.create", json!({"name": "  Home  "}));
    assert_eq!(p["name"], "Home", "names are trimmed");
    assert_eq!(p["statuses"], json!(["Backlog", "Planning", "In Progress", "Done"]));
}

#[test]
fn task_lifecycle_priority_band_and_completion() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "Fix tap", "priority": 7}));
    assert_eq!(t["status"], "Backlog", "new tasks start at the first status");
    assert_eq!(t["band"], "High");
    assert!(t["completed_at"].is_null());

    let t = ok(&c, "tasks.update", json!({"id": t["id"], "status": "Done"}));
    assert!(t["completed_at"].is_i64(), "reaching the last status records completedAt");
    let first = t["completed_at"].clone();

    let t = ok(&c, "tasks.update", json!({"id": t["id"], "title": "Fix the tap"}));
    assert_eq!(t["completed_at"], first, "unrelated edits keep completedAt");

    let t = ok(&c, "tasks.update", json!({"id": t["id"], "status": "In Progress"}));
    assert!(t["completed_at"].is_null(), "leaving the last status clears completedAt");

    let t = ok(&c, "tasks.update", json!({"id": t["id"], "priority": 10}));
    assert_eq!(t["band"], "Urgent");
}

#[test]
fn the_completion_status_is_whatever_the_project_ends_with() {
    let c = core();
    let p = ok(&c, "projects.create", json!({"name": "Shop", "statuses": ["To buy", "Bought"]}));
    let t = ok(&c, "tasks.create", json!({"project_id": p["id"], "title": "Milk", "status": "Bought"}));
    assert!(t["completed_at"].is_i64(), "creating directly in the last status completes it");
}

#[test]
fn validation_errors_are_typed_and_name_the_field() {
    let c = core();
    let pid = project(&c);
    let e = err(&c, "tasks.create", json!({"project_id": pid, "title": "   "}));
    assert_eq!((e.code.as_str(), e.details.unwrap()["field"].as_str().unwrap().to_string()), ("invalid_input", "title".into()));
    assert_eq!(err(&c, "tasks.create", json!({"project_id": pid, "title": "x", "priority": 11})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.create", json!({"project_id": pid, "title": "x", "due": "2026-02-30"})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.create", json!({"project_id": pid, "title": "x", "status": "Nope"})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.create", json!({"project_id": pid, "title": "x", "surprise": 1})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.create", json!({"project_id": "missing", "title": "x"})).code, "not_found");
    assert_eq!(err(&c, "nothing.here", json!({})).code, "unknown_op");
}

#[test]
fn custom_attributes_follow_the_project_schema() {
    let c = core();
    let p = ok(&c, "projects.create", json!({"name": "Build", "attributes": {"estimate": "number", "reviewed": "boolean", "ship": "date"}}));
    let t = ok(&c, "tasks.create", json!({"project_id": p["id"], "title": "Roof", "attributes": {"estimate": 3.5, "reviewed": false}}));
    assert_eq!(t["attributes"]["estimate"], 3.5);
    assert_eq!(err(&c, "tasks.update", json!({"id": t["id"], "attributes": {"estimate": "a lot"}})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.update", json!({"id": t["id"], "attributes": {"colour": "red"}})).code, "invalid_input");
    assert_eq!(err(&c, "tasks.update", json!({"id": t["id"], "attributes": {"ship": "2026-02-30"}})).code, "invalid_input");
    let t = ok(&c, "tasks.update", json!({"id": t["id"], "attributes": {"estimate": null, "ship": "2026-12-01"}}));
    assert_eq!(t["attributes"], json!({"reviewed": false, "ship": "2026-12-01"}), "null removes a value, others merge");
    let e = err(&c, "projects.update", json!({"id": p["id"], "attributes": {"estimate": "number"}}));
    assert_eq!(e.code, "conflict", "cannot drop an attribute that tasks use ('reviewed' has a value)");
}

#[test]
fn removing_a_status_that_tasks_use_is_refused() {
    let c = core();
    let pid = project(&c);
    ok(&c, "tasks.create", json!({"project_id": pid, "title": "x", "status": "Planning"}));
    let e = err(&c, "projects.update", json!({"id": pid, "statuses": ["Backlog", "Done"]}));
    assert_eq!(e.code, "conflict");
    assert!(e.message.contains("Planning"));
    assert_eq!(err(&c, "projects.delete", json!({"id": pid})).code, "conflict", "a project with tasks cannot be deleted");
}

#[test]
fn comments_allow_one_level_of_replies() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "t"}));
    let c1 = ok(&c, "comments.add", json!({"task_id": t["id"], "text": "first"}));
    let r1 = ok(&c, "comments.add", json!({"task_id": t["id"], "text": "reply", "parent_id": c1["id"]}));
    let e = err(&c, "comments.add", json!({"task_id": t["id"], "text": "reply to reply", "parent_id": r1["id"]}));
    assert_eq!(e.code, "conflict");
    assert!(e.message.contains("cannot be replied to"));
    let t2 = ok(&c, "tasks.create", json!({"project_id": pid, "title": "other"}));
    assert_eq!(err(&c, "comments.add", json!({"task_id": t2["id"], "text": "x", "parent_id": c1["id"]})).code, "conflict");
    assert_eq!(ok(&c, "comments.list", json!({"task_id": t["id"]})).as_array().unwrap().len(), 2);
    ok(&c, "comments.delete", json!({"id": c1["id"]}));
    assert_eq!(ok(&c, "comments.list", json!({"task_id": t["id"]})).as_array().unwrap().len(), 0, "deleting a comment deletes its replies");
}

#[test]
fn follow_ups_do_not_touch_the_description() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "t", "description": "original"}));
    ok(&c, "followups.add", json!({"task_id": t["id"], "text": "new development"}));
    assert_eq!(ok(&c, "tasks.get", json!({"id": t["id"]}))["description"], "original");
    assert_eq!(ok(&c, "followups.list", json!({"task_id": t["id"]})).as_array().unwrap().len(), 1);
}

#[test]
fn deleting_a_task_removes_its_comments_and_follow_ups() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "t"}));
    ok(&c, "comments.add", json!({"task_id": t["id"], "text": "c"}));
    ok(&c, "followups.add", json!({"task_id": t["id"], "text": "f"}));
    ok(&c, "tasks.delete", json!({"id": t["id"]}));
    for col in ["tasks", "comments", "followups"] {
        assert!(c.ports().db.query(&Query::new(col)).unwrap().is_empty(), "{col} should be empty");
    }
}

#[test]
fn listing_filters_and_searches() {
    let c = core();
    let pid = project(&c);
    for (title, status) in [("Buy milk", "Backlog"), ("Call MILKman", "Planning"), ("Paint", "Backlog")] {
        ok(&c, "tasks.create", json!({"project_id": pid, "title": title, "status": status}));
    }
    assert_eq!(ok(&c, "tasks.list", json!({"q": "milk"})).as_array().unwrap().len(), 2);
    assert_eq!(ok(&c, "tasks.list", json!({"status": "Backlog"})).as_array().unwrap().len(), 2);
    assert_eq!(ok(&c, "projects.list", json!({}))[0]["task_count"], 3);
}

// ---------- the kernel doing its job ----------

#[test]
fn idempotency_replays_instead_of_repeating() {
    let c = core();
    let pid = project(&c);
    let req = |title: &str| CallRequest {
        op: "tasks.create".into(),
        input: json!({"project_id": pid, "title": title}),
        idempotency_key: Some("key-1".into()),
        ..Default::default()
    };
    let first = c.call(req("once")).unwrap();
    let second = c.call(req("once")).unwrap();
    assert!(!first.replayed && second.replayed);
    assert_eq!(first.data["id"], second.data["id"]);
    assert_eq!(ok(&c, "tasks.list", json!({})).as_array().unwrap().len(), 1, "the handler ran once");
    assert_eq!(c.call(req("different")).unwrap_err().code, "idempotency_conflict");
}

#[test]
fn events_can_be_resumed_from_a_sequence_number() {
    let c = core();
    let pid = project(&c); // event 1: project.created
    let seen = c.latest_seq();
    ok(&c, "tasks.create", json!({"project_id": pid, "title": "a"}));
    ok(&c, "tasks.create", json!({"project_id": pid, "title": "b"}));
    let events = c.events_since("local-user", seen, 100).unwrap();
    assert_eq!(events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["task.created", "task.created"]);
    assert_eq!(events[0].seq, seen + 1, "sequence numbers are gapless");
    assert!(c.events_since("local-user", c.latest_seq(), 100).unwrap().is_empty());
    assert!(c.events_since("someone-else", 0, 100).unwrap().is_empty(), "events are private to their audience");
}

#[test]
fn a_failed_call_publishes_nothing() {
    let c = core();
    let before = c.latest_seq();
    let _ = call(&c, "tasks.create", json!({"project_id": "missing", "title": "x"}));
    assert_eq!(c.latest_seq(), before);
}

#[test]
fn audit_records_old_and_new_values() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "before"}));
    ok(&c, "tasks.update", json!({"id": t["id"], "title": "after"}));
    ok(&c, "tasks.delete", json!({"id": t["id"]}));
    let log = ok(&c, "audit.list", json!({"entity_id": t["id"]}));
    let ops: Vec<&str> = log.as_array().unwrap().iter().map(|e| e["op"].as_str().unwrap()).collect();
    assert_eq!(ops, ["tasks.delete", "tasks.update", "tasks.create"], "newest first");
    let update = &log[1];
    assert_eq!(update["old"]["title"], "before");
    assert_eq!(update["new"]["title"], "after");
    assert!(log[0]["new"].is_null() && log[0]["old"]["title"] == "after");
    assert!(log[2]["old"].is_null());
}

#[test]
fn disabling_a_plugin_removes_everything_it_added_and_keeps_its_data() {
    let c = core();
    let pid = project(&c);
    ok(&c, "tasks.create", json!({"project_id": pid, "title": "x"}));
    let entries = c.ports().db.query(&Query::new("audit")).unwrap().len();
    assert!(entries > 0);
    c.disable("audit").unwrap();
    assert_eq!(err(&c, "audit.list", json!({})).code, "unknown_op");
    ok(&c, "tasks.create", json!({"project_id": pid, "title": "y"}));
    assert_eq!(c.ports().db.query(&Query::new("audit")).unwrap().len(), entries, "the hooks no longer run");
    let d = c.describe(None, None);
    assert!(d["inactive"].as_array().unwrap().iter().any(|i| i["id"] == "audit"));
    assert_eq!(c.disable("adapter-memory").unwrap_err().code, "conflict", "adapters cannot be unplugged while running");
}

#[test]
fn describe_is_the_self_description_a_face_needs() {
    let c = core();
    let d = c.describe(None, Some("web"));
    assert_eq!(d["contract"], CONTRACT_VERSION);
    assert_eq!(d["ports"]["db"], "adapter-memory");
    assert!(d["ops"].as_array().unwrap().iter().any(|o| o["name"] == "tasks.create" && o["plugin"] == "tasks"));
    assert_eq!(d["slots"][0]["id"], "export");
    assert_eq!(d["assets"].as_array().unwrap().iter().filter(|a| a["kind"] == "theme").count(), 2);
    assert_eq!(d["signin"]["kind"], "none");
    assert_eq!(d["identity"]["subject"], "local-user");
    assert_eq!(c.describe(None, Some("cli"))["slots"].as_array().unwrap().len(), 0, "slots can be limited to certain faces");
}

// ---------- replacing auth and policy ----------

#[test]
fn token_auth_isolates_users_and_policy_blocks_writes() {
    let c = start(server_dist()).unwrap();
    assert_eq!(call_as(&c, None, "projects.list", json!({})).unwrap_err().code, "unauthenticated");
    assert_eq!(call_as(&c, Some("wrong"), "projects.list", json!({})).unwrap_err().code, "unauthenticated");

    let p = call_as(&c, Some("t-alice"), "projects.create", json!({"name": "Alice's"})).unwrap();
    assert_eq!(call_as(&c, Some("t-bob"), "projects.list", json!({})).unwrap(), json!([]), "Bob sees nothing of Alice's");
    assert_eq!(call_as(&c, Some("t-bob"), "projects.get", json!({"id": p["id"]})).unwrap_err().code, "not_found", "and cannot even tell it exists");

    let e = call_as(&c, Some("t-view"), "projects.create", json!({"name": "no"})).unwrap_err();
    assert_eq!(e.code, "permission_denied");
    assert_eq!(e.details.unwrap()["missing"], "tasks.write", "the error names the missing permission");
    assert_eq!(call_as(&c, Some("t-view"), "projects.list", json!({})).unwrap().as_array().unwrap().len(), 1, "a viewer shares the subject, so reads work");
    assert_eq!(call_as(&c, Some("t-bob"), "audit.list", json!({})).unwrap().as_array().unwrap().len(), 0, "members may read their own audit log");

    let d = c.describe(Some("t-view"), None);
    let allowed = |name: &str| d["ops"].as_array().unwrap().iter().find(|o| o["name"] == name).unwrap()["allowed"].clone();
    assert_eq!((allowed("tasks.list"), allowed("tasks.create")), (json!(true), json!(false)), "describe carries the permission map");
    assert_eq!(d["signin"]["kind"], "token");
}

#[test]
fn quota_plugin_vetoes_and_nothing_is_written() {
    let c = start(server_dist()).unwrap();
    let p = call_as(&c, Some("t-alice"), "projects.create", json!({"name": "P"})).unwrap();
    for i in 0..3 {
        call_as(&c, Some("t-alice"), "tasks.create", json!({"project_id": p["id"], "title": format!("t{i}")})).unwrap();
    }
    let e = call_as(&c, Some("t-alice"), "tasks.create", json!({"project_id": p["id"], "title": "one too many"})).unwrap_err();
    assert_eq!(e.code, "quota_exceeded");
    assert_eq!(e.http_status(), 429);
    assert_eq!(call_as(&c, Some("t-alice"), "tasks.list", json!({})).unwrap().as_array().unwrap().len(), 3);
}

// ---------- the resolver ----------

fn with(mut d: Distribution, f: impl FnOnce(&mut Distribution)) -> Vec<String> {
    f(&mut d);
    match Core::start(d) {
        Ok(_) => vec![],
        Err(p) => p,
    }
}

#[test]
fn resolver_explains_every_problem_before_starting() {
    let problems = with(memory_for_tests(), |d| d.enabled.push("adapter-sqlite".into()));
    assert!(problems.iter().any(|p| p.contains("`db` is ambiguous") && p.contains("adapter-sqlite") && p.contains("adapter-memory")), "{problems:?}");

    let ok = with(memory_for_tests(), |d| {
        d.enabled.push("adapter-sqlite".into());
        d.bindings.insert("db".into(), "adapter-memory".into());
    });
    assert!(ok.is_empty(), "binding resolves the ambiguity: {ok:?}");

    let problems = with(memory_for_tests(), |d| d.enabled.retain(|e| e != "auth-local"));
    assert!(problems.iter().any(|p| p.contains("port `auth` has no adapter")), "{problems:?}");

    let problems = with(memory_for_tests(), |d| {
        d.enabled.retain(|e| e != "auth-local" && e != "adapter-memory");
        d.enabled.push("ghost".into());
    });
    assert!(problems.len() >= 3, "all problems are reported together: {problems:?}");

    let problems = with(memory_for_tests(), |d| {
        d.bindings.insert("db".into(), "adapter-sqlite".into());
    });
    assert!(problems.iter().any(|p| p.contains("bound to `adapter-sqlite`")), "{problems:?}");
}

struct Rogue(&'static str, Vec<&'static str>, bool);
impl Plugin for Rogue {
    fn manifest(&self) -> Manifest {
        Manifest::parse(&json!({"id": self.0, "version":"0.0.1","contributes":{"ops": self.1}}).to_string())
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        if self.2 {
            a.op(OpSpec::query("rogue.peek", "tasks.read", "reads the db without declaring it", json!({"type":"object"})), |_c, _i, svc| {
                svc.db()?.get("tasks", "x").map(|_| json!(null))
            });
        }
        Ok(())
    }
}

#[test]
fn the_broker_denies_capabilities_a_manifest_did_not_ask_for() {
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Rogue("rogue", vec!["rogue.peek"], true)));
    d.enabled.push("rogue".into());
    let c = Core::start(d).unwrap();
    let e = call(&c, "rogue.peek", json!({})).unwrap_err();
    assert_eq!(e.code, "capability_denied");
}

#[test]
fn a_plugin_must_register_exactly_the_ops_it_declares() {
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Rogue("liar", vec!["liar.one"], false)));
    d.enabled.push("liar".into());
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("declares op `liar.one` but did not register it")), "{problems:?}");

    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Rogue("sneaky", vec![], true)));
    d.enabled.push("sneaky".into());
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("registered op `rogue.peek` but its manifest does not declare it")), "{problems:?}");
}

#[test]
fn two_plugins_cannot_define_the_same_op() {
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Rogue("one", vec!["rogue.peek"], true)));
    d.catalog.push(std::sync::Arc::new(Rogue("two", vec!["rogue.peek"], true)));
    d.enabled.extend(["one".to_string(), "two".to_string()]);
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("`rogue.peek` is defined by both")), "{problems:?}");
}

// ---------- adapters are swappable under the same domain ----------

#[test]
fn the_same_session_works_on_sqlite_with_a_file() {
    let dir = std::env::temp_dir().join(format!("nuah-madar-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("m.db");
    let _ = std::fs::remove_file(&path);
    let c = start(embedded(path.to_str().unwrap(), "Tester")).unwrap();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "persisted"}));
    drop(c);
    let c = start(embedded(path.to_str().unwrap(), "Tester")).unwrap();
    assert_eq!(ok(&c, "tasks.get", json!({"id": t["id"]}))["title"], "persisted", "data survives a restart");
    assert_eq!(c.latest_seq(), 2, "and so does the event sequence");
    let _ = std::fs::remove_dir_all(&dir);
}
