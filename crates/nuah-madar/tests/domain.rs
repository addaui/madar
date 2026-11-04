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

// ---------- review round 1: atomicity, protected storage, resolver, privacy ----------

struct Fragile;
impl Plugin for Fragile {
    fn manifest(&self) -> Manifest {
        Manifest::parse(&json!({"id":"fragile","version":"0.0.1","requires":{"ports":["db"]},"contributes":{"ops":[]}}).to_string())
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        // an after-hook that always fails, like an audit sink whose storage is down
        a.after("always-fails", "tasks.create", 200, |_c, _s, _i, _r, _svc| Err(LinkError::internal("sink down")));
        Ok(())
    }
}

#[test]
fn a_failing_hook_rolls_back_the_data_the_events_and_the_idempotency_record() {
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Fragile));
    d.enabled.push("fragile".into());
    let c = Core::start(d).unwrap();
    let pid = project(&c);
    let (events_before, audit_before) = (c.latest_seq(), c.ports().db.query(&Query::new("audit")).unwrap().len());
    let req = CallRequest { op: "tasks.create".into(), input: json!({"project_id": pid, "title": "doomed"}), idempotency_key: Some("k".into()), ..Default::default() };
    assert_eq!(c.call(req.clone()).unwrap_err().code, "internal");
    assert!(c.ports().db.query(&Query::new("tasks")).unwrap().is_empty(), "the task was not kept");
    assert_eq!(c.latest_seq(), events_before, "no event was published");
    assert_eq!(c.ports().db.query(&Query::new("audit")).unwrap().len(), audit_before, "the audit row was rolled back too");
    assert!(c.ports().db.query(&Query::new("_idem")).unwrap().is_empty(), "the key was not consumed, so a retry can succeed");
    c.disable("fragile").unwrap();
    assert!(c.call(req).is_ok(), "the retry with the same key works once the fault is gone");
}

#[test]
fn plugins_cannot_touch_the_kernels_collections() {
    let mut d = memory_for_tests();
    struct Snoop;
    impl Plugin for Snoop {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id":"snoop","version":"0.0.1","requires":{"ports":["db"]},"contributes":{"ops":["snoop.read","snoop.forge"]}}).to_string())
        }
        fn activate(&self, a: &mut Activation) -> Result<()> {
            a.op(OpSpec::query("snoop.read", "tasks.read", "", json!({"type":"object"})), |_c, _i, svc| Ok(json!(svc.db()?.query(&Query::new("_idem"))?)));
            a.op(OpSpec::command("snoop.forge", "tasks.write", "", json!({"type":"object"})), |_c, _i, svc| {
                svc.db()?.put("_events", "000000000099", &json!({"seq": 99, "audience": "local-user"}))?;
                Ok(json!(null))
            });
            Ok(())
        }
    }
    d.catalog.push(std::sync::Arc::new(Snoop));
    d.enabled.push("snoop".into());
    let c = Core::start(d).unwrap();
    assert_eq!(err(&c, "snoop.read", json!({})).code, "capability_denied");
    assert_eq!(err(&c, "snoop.forge", json!({})).code, "capability_denied");
    assert_eq!(c.latest_seq(), 0, "nothing was forged");
}

#[test]
fn an_adapter_cannot_fill_a_port_it_is_not_bound_to() {
    struct Greedy;
    impl Plugin for Greedy {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id":"greedy-db","version":"0.0.1","implements":[{"port":"db"}]}).to_string())
        }
        fn activate(&self, a: &mut Activation) -> Result<()> {
            a.provide_db(std::sync::Arc::new(nuah_adapters::memory::MemoryDb::new()));
            struct Open;
            impl Policy for Open {
                fn id(&self) -> &str { "sneaky" }
                fn check(&self, _w: &Identity, _p: &str) -> bool { true }
            }
            a.provide_policy(std::sync::Arc::new(Open)); // not what the manifest said it implements
            Ok(())
        }
    }
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Greedy));
    d.enabled.push("greedy-db".into());
    d.bindings.insert("db".into(), "greedy-db".into());
    d.enabled.retain(|e| e != "adapter-memory");
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("provided port `policy` but is not bound to it")), "{problems:?}");
}

#[test]
fn resolver_checks_capabilities_routes_and_duplicate_ids() {
    struct Typo(&'static str, &'static str);
    impl Plugin for Typo {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id": self.0, "version":"0.0.1","requires":{"capabilities":[self.1]},"contributes":{"ops":[],"routes":["GET /x/ghost"]}}).to_string())
        }
        fn activate(&self, _a: &mut Activation) -> Result<()> { Ok(()) }
    }
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Typo("typo", "event")));
    d.catalog.push(std::sync::Arc::new(Typo("twin", "events")));
    d.catalog.push(std::sync::Arc::new(Typo("twin", "events")));
    d.enabled.extend(["typo".to_string(), "twin".to_string()]);
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("share the id `twin`")), "{problems:?}");
    assert!(problems.iter().any(|p| p.contains("unknown capability `event`")), "{problems:?}");
    assert!(problems.iter().any(|p| p.contains("unknown capability `event`")), "{problems:?}");

    // the route check runs in a later phase, once plugins have activated
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Typo("ghost", "events")));
    d.enabled.push("ghost".into());
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("declares route `GET /X/GHOST` but did not register it")), "{problems:?}");
}

#[test]
fn describe_before_sign_in_reveals_only_how_to_sign_in() {
    let c = start(server_dist()).unwrap();
    let d = c.describe(None, None);
    assert!(d["identity"].is_null());
    assert_eq!(d["signin"]["kind"], "token");
    for hidden in ["ops", "plugins", "ports", "slots", "latest_seq"] {
        assert!(d.get(hidden).is_none(), "`{hidden}` must not be visible before sign-in");
    }
    call_as(&c, Some("t-alice"), "projects.create", json!({"name": "A"})).unwrap();
    assert_eq!(c.describe(Some("t-alice"), None)["latest_seq"], 1);
    assert_eq!(c.describe(Some("t-bob"), None)["latest_seq"], 0, "latest_seq counts only the caller's events");
}

#[test]
fn whole_number_floats_are_not_integers() {
    let c = core();
    let pid = project(&c);
    assert_eq!(err(&c, "tasks.create", json!({"project_id": pid, "title": "x", "priority": 7.0})).code, "invalid_input");
}

#[test]
fn quota_holds_under_concurrent_creates() {
    let c = start(server_dist()).unwrap(); // max_tasks = 3
    let p = call_as(&c, Some("t-alice"), "projects.create", json!({"name": "P"})).unwrap();
    let handles: Vec<_> = (0..12).map(|i| {
        let (c, pid) = (c.clone(), p["id"].clone());
        std::thread::spawn(move || call_as(&c, Some("t-alice"), "tasks.create", json!({"project_id": pid, "title": format!("t{i}")})))
    }).collect();
    let ok = handles.into_iter().map(|h| h.join().unwrap()).filter(|r| r.is_ok()).count();
    assert_eq!(ok, 3, "exactly the quota succeeds, however the calls interleave");
    assert_eq!(call_as(&c, Some("t-alice"), "tasks.list", json!({})).unwrap().as_array().unwrap().len(), 3);
}

#[test]
fn two_cores_on_one_database_file_never_share_an_event_number() {
    let dir = std::env::temp_dir().join(format!("nuah-two-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("shared.db");
    let _ = std::fs::remove_file(&path);
    let a = start(embedded(path.to_str().unwrap(), "A")).unwrap();
    let b = start(embedded(path.to_str().unwrap(), "B")).unwrap();
    let mut handles = vec![];
    for (i, c) in [a.clone(), b.clone()].into_iter().enumerate() {
        handles.push(std::thread::spawn(move || {
            let pid = ok(&c, "projects.create", json!({"name": format!("P{i}")}))["id"].clone();
            for n in 0..15 { ok(&c, "tasks.create", json!({"project_id": pid, "title": format!("{i}-{n}")})); }
        }));
    }
    for h in handles { h.join().unwrap(); }
    let events = a.events_since("local-user", 0, 1000).unwrap();
    assert_eq!(events.len(), 32, "no event was overwritten");
    assert_eq!(events.iter().map(|e| e.seq).collect::<Vec<_>>(), (1..=32).collect::<Vec<u64>>(), "numbers are unique and gapless");
    assert_eq!(b.events_since("local-user", 30, 100).unwrap().len(), 2, "each core sees the other's events");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stale_edits_are_refused_instead_of_overwriting() {
    let c = core();
    let pid = project(&c);
    let t = ok(&c, "tasks.create", json!({"project_id": pid, "title": "t"}));
    assert_eq!(t["version"], 1);
    let t2 = ok(&c, "tasks.update", json!({"id": t["id"], "title": "by A", "expected_version": 1}));
    assert_eq!(t2["version"], 2);
    let e = err(&c, "tasks.update", json!({"id": t["id"], "title": "by B, who saw version 1", "expected_version": 1}));
    assert_eq!(e.code, "conflict");
    assert_eq!(e.details.unwrap()["current_version"], 2);
    assert_eq!(ok(&c, "tasks.get", json!({"id": t["id"]}))["title"], "by A");
    // without expected_version the last write wins, as before
    assert_eq!(ok(&c, "tasks.update", json!({"id": t["id"], "title": "blind"}))["version"], 3);
}

// ---------- round 2: ownership, dependencies, plugin-to-plugin calls ----------

struct Meddler(&'static str, &'static str);
impl Plugin for Meddler {
    fn manifest(&self) -> Manifest {
        Manifest::parse(&json!({"id": self.0, "version":"0.0.1","requires":{"ports":["db"]},
            "data": {"owns": ["meddler_own"], "reads": [self.1]}, "contributes":{"ops":["meddler.write", "meddler.read"]}}).to_string())
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.op(OpSpec::command("meddler.write", "tasks.write", "", json!({"type":"object"})), |_c, _i, svc| {
            svc.db()?.put("meddler_own", "x", &json!({"id":"x"}))?;           // allowed: owned
            svc.db()?.put("tasks", "evil", &json!({"id":"evil"}))?;           // not owned
            Ok(json!(null))
        });
        a.op(OpSpec::query("meddler.read", "tasks.read", "", json!({"type":"object"})), |_c, _i, svc| {
            Ok(json!(svc.db()?.query(&Query::new("projects"))?.len()))        // only allowed if declared in reads
        });
        Ok(())
    }
}

#[test]
fn a_plugin_may_write_only_what_it_owns_and_read_only_what_it_declared() {
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Meddler("meddler", "tasks")));
    d.enabled.push("meddler".into());
    let c = Core::start(d).unwrap();
    assert_eq!(err(&c, "meddler.write", json!({})).code, "capability_denied");
    assert!(c.ports().db.get("meddler_own", "x").unwrap().is_none(), "the denied call rolled back its allowed write too");
    assert!(c.ports().db.get("tasks", "evil").unwrap().is_none());
    assert_eq!(err(&c, "meddler.read", json!({})).code, "capability_denied", "`projects` was not declared in reads");
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Meddler("meddler", "projects")));
    d.enabled.push("meddler".into());
    let c = Core::start(d).unwrap();
    project(&c);
    assert_eq!(ok(&c, "meddler.read", json!({})), 1, "declared reads work");
}

#[test]
fn plugin_dependencies_are_checked_at_start_and_at_disable() {
    let problems = with(memory_for_tests(), |d| d.enabled.retain(|e| e != "tasks"));
    assert!(problems.iter().any(|p| p.contains("`quota`") || p.contains("`export`")), "{problems:?}");
    assert!(problems.iter().any(|p| p.contains("requires plugin `tasks`, which is not enabled")), "{problems:?}");

    // version prefix: "tasks@0.1" matches 0.1.0, "tasks@9" does not
    struct Needy(&'static str);
    impl Plugin for Needy {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id":"needy","version":"0.0.1","requires":{"plugins":[self.0]},"contributes":{"ops":[]}}).to_string())
        }
        fn activate(&self, _a: &mut Activation) -> Result<()> { Ok(()) }
    }
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Needy("tasks@0.1")));
    d.enabled.push("needy".into());
    assert!(Core::start(d).is_ok());
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Needy("tasks@9")));
    d.enabled.push("needy".into());
    let problems = Core::start(d).err().unwrap();
    assert!(problems.iter().any(|p| p.contains("`tasks@9`") && p.contains("0.1.0")), "{problems:?}");

    let c = core();
    let e = c.disable("tasks").unwrap_err();
    assert_eq!(e.code, "conflict");
    assert!(e.message.contains("`export`"), "{}", e.message);
    c.disable("export").unwrap();
    c.disable("tasks").unwrap();
    assert_eq!(err(&c, "tasks.list", json!({})).code, "unknown_op");
}

#[test]
fn export_goes_through_the_task_plugins_contract_as_the_caller() {
    let c = start(server_dist()).unwrap();
    let p = call_as(&c, Some("t-alice"), "projects.create", json!({"name": "E"})).unwrap();
    let t = call_as(&c, Some("t-alice"), "tasks.create", json!({"project_id": p["id"], "title": "exported"})).unwrap();
    call_as(&c, Some("t-alice"), "comments.add", json!({"task_id": t["id"], "text": "note"})).unwrap();
    call_as(&c, Some("t-bob"), "projects.create", json!({"name": "Bob's secret"})).unwrap();
    let route = |token: &str| c.route("GET", "/x/export/madar.json", Some(token), Default::default(), vec![]);
    let body: Value = serde_json::from_slice(&route("t-alice").unwrap().body).unwrap();
    assert_eq!(body["projects"].as_array().unwrap().len(), 1, "only the caller's data, because the call runs as the caller");
    assert_eq!(body["tasks"][0]["title"], "exported");
    assert_eq!(body["comments"][0]["text"], "note");
    assert_eq!(route("t-view").unwrap().status, 200, "a viewer may export: tasks.read is enough");
    assert_eq!(route("nobody").err().unwrap().code, "unauthenticated");
}

#[test]
fn a_plugin_cannot_call_a_plugin_it_did_not_declare() {
    struct Caller;
    impl Plugin for Caller {
        fn manifest(&self) -> Manifest {
            // requires `prefs` only, then tries to call `tasks`
            Manifest::parse(&json!({"id":"caller","version":"0.0.1","requires":{"plugins":["prefs"]},"contributes":{"ops":["caller.go"]}}).to_string())
        }
        fn activate(&self, a: &mut Activation) -> Result<()> {
            a.op(OpSpec::command("caller.go", "tasks.write", "", json!({"type":"object"})), |ctx, _i, svc| svc.call(ctx, "projects.create", json!({"name": "sneaky"})));
            Ok(())
        }
    }
    let mut d = memory_for_tests();
    d.catalog.push(std::sync::Arc::new(Caller));
    d.enabled.push("caller".into());
    let c = Core::start(d).unwrap();
    assert_eq!(err(&c, "caller.go", json!({})).code, "capability_denied");
}

#[test]
fn nested_calls_keep_the_callers_permissions_and_roll_back_together() {
    struct Chain;
    impl Plugin for Chain {
        fn manifest(&self) -> Manifest {
            Manifest::parse(&json!({"id":"chain","version":"0.0.1","requires":{"plugins":["tasks"],"capabilities":["events"]},"contributes":{"ops":["chain.make"]}}).to_string())
        }
        fn activate(&self, a: &mut Activation) -> Result<()> {
            a.op(OpSpec::command("chain.make", "prefs.write", "creates a project, then a task in it, then fails on demand", json!({"type":"object"})), |ctx, i, svc| {
                let p = svc.call(ctx, "projects.create", json!({"name": "via chain"}))?;
                svc.call(ctx, "tasks.create", json!({"project_id": p["id"], "title": "inner"}))?;
                if i.get("fail").is_some() { return Err(LinkError::internal("late failure")); }
                Ok(p)
            });
            Ok(())
        }
    }
    let mut d = server_dist();
    d.catalog.push(std::sync::Arc::new(Chain));
    d.enabled.push("chain".into());
    let c = Core::start(d).unwrap();
    // a viewer has prefs.write (so may call chain.make) but not tasks.write: the inner call is refused
    let e = call_as(&c, Some("t-view"), "chain.make", json!({})).unwrap_err();
    assert_eq!((e.code.as_str(), e.details.unwrap()["missing"].clone()), ("permission_denied", json!("tasks.write")));
    // the owner succeeds; events from the nested calls are published
    let before = c.latest_seq_for("alice");
    call_as(&c, Some("t-alice"), "chain.make", json!({})).unwrap();
    assert_eq!(c.events_since("alice", before, 10).unwrap().iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["project.created", "task.created"]);
    // a failure after the nested calls undoes them, and their events
    let (projects, seq) = (call_as(&c, Some("t-alice"), "projects.list", json!({})).unwrap().as_array().unwrap().len(), c.latest_seq());
    assert!(call_as(&c, Some("t-alice"), "chain.make", json!({"fail": true})).is_err());
    assert_eq!(call_as(&c, Some("t-alice"), "projects.list", json!({})).unwrap().as_array().unwrap().len(), projects);
    assert_eq!(c.latest_seq(), seq);
}
