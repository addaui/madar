//! Kernel features added in round 4: settings schemas, index requests, hook order constraints,
//! event payload schemas, port output schemas.

use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

struct T {
    manifest: Value,
    act: Box<dyn Fn(&mut Activation) + Send + Sync>,
}
impl Plugin for T {
    fn manifest(&self) -> Manifest {
        Manifest::parse(&self.manifest.to_string())
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        (self.act)(a);
        Ok(())
    }
}
fn t(manifest: Value, act: impl Fn(&mut Activation) + Send + Sync + 'static) -> Arc<dyn Plugin> {
    Arc::new(T { manifest, act: Box::new(act) })
}
fn dist_with(extra: Vec<Arc<dyn Plugin>>, enable: &[&str]) -> Distribution {
    let mut d = memory_for_tests();
    d.catalog.extend(extra);
    d.enabled.extend(enable.iter().map(|s| s.to_string()));
    d
}
fn problems(d: Distribution) -> String {
    match Core::start(d) {
        Ok(_) => panic!("should not start"),
        Err(p) => p.join("\n"),
    }
}
fn call(core: &Core, op: &str, input: Value) -> Result<Value> {
    core.call(CallRequest { op: op.into(), input, ..Default::default() }).map(|r| r.data)
}

#[test]
fn settings_are_checked_against_the_plugins_schema() {
    let p = || t(json!({"id":"s","version":"1","settings_schema":{"type":"object","required":["limit"],"properties":{"limit":{"type":"integer","minimum":1}}}}), |_| {});
    let msg = problems(dist_with(vec![p()], &["s"]));
    assert!(msg.contains("settings of plugin `s`"), "{msg}");
    let mut d = dist_with(vec![p()], &["s"]);
    d.settings.insert("s".into(), json!({"limit": 0}));
    assert!(problems(d).contains("settings of plugin `s`"));
    let mut d = dist_with(vec![p()], &["s"]);
    d.settings.insert("s".into(), json!({"limit": 5}));
    Core::start(d).unwrap();
}

#[test]
fn index_requests_must_name_an_owned_collection_and_a_valid_field() {
    let m = |idx: Value| json!({"id":"i","version":"1","data":{"owns":["things"],"indexes":idx}});
    let msg = problems(dist_with(vec![t(m(json!([{"collection":"other","field":"a"}])), |_| {})], &["i"]));
    assert!(msg.contains("does not own that collection"), "{msg}");
    let msg = problems(dist_with(vec![t(m(json!([{"collection":"things","field":"a b"}])), |_| {})], &["i"]));
    assert!(msg.contains("invalid field path"), "{msg}");
    Core::start(dist_with(vec![t(m(json!([{"collection":"things","field":"a"}])), |_| {})], &["i"])).unwrap();
}

fn recorder(id: &'static str, order: Value, log: Arc<Mutex<Vec<String>>>) -> Arc<dyn Plugin> {
    t(json!({"id": id, "version":"1", "order": order}), move |a| {
        let log = log.clone();
        a.before(id, "projects.create", 0, move |_, _, _, _| {
            log.lock().unwrap().push(id.to_string());
            Ok(())
        });
    })
}
#[test]
fn hook_order_constraints_decide_between_equal_priorities_and_cycles_are_reported() {
    let log = Arc::new(Mutex::new(vec![]));
    // by id alone: a, b, c. The constraints say c first, then a, then b.
    let plugins = vec![
        recorder("a", serde_json::json!({"after": ["c"]}), log.clone()),
        recorder("b", serde_json::json!({"after": ["a"]}), log.clone()),
        recorder("c", serde_json::json!({"before": ["a"]}), log.clone()),
    ];
    let core = Core::start(dist_with(plugins, &["a", "b", "c"])).unwrap();
    call(&core, "projects.create", serde_json::json!({"name": "x"})).unwrap();
    assert_eq!(*log.lock().unwrap(), ["c", "a", "b"]);
    let d = core.describe(None, None);
    let hooks: Vec<&str> = d["hooks"].as_array().unwrap().iter().filter(|h| h["name"].as_str().is_some_and(|n| ["a","b","c"].contains(&n))).map(|h| h["plugin"].as_str().unwrap()).collect();
    assert_eq!(hooks, ["c", "a", "b"], "describe lists hooks in the order they run");

    let cyc = vec![
        recorder("a", serde_json::json!({"after": ["b"]}), log.clone()),
        recorder("b", serde_json::json!({"after": ["a"]}), log.clone()),
    ];
    assert!(problems(dist_with(cyc, &["a", "b"])).contains("form a cycle"));
    let unknown = vec![recorder("a", serde_json::json!({"after": ["ghost"]}), log.clone())];
    assert!(problems(dist_with(unknown, &["a"])).contains("unknown plugin `ghost`"));
}

#[test]
fn event_payloads_and_port_answers_can_carry_schemas() {
    let emitter = t(json!({"id":"em","version":"1","requires":{"capabilities":["events"]},
        "contributes":{"ops":["em.go"],"events":["em.did"],"event_schemas":{"em.did":{"type":"object","required":["n"],"properties":{"n":{"type":"integer"}}}}}}),
        |a| {
            a.op(OpSpec::command("em.go", "em.write", "emit", json!({"type":"object","additionalProperties":true,"properties":{}})),
                |ctx, input, svc| {
                    svc.emit("em.did", &ctx.subject, input.clone())?;
                    Ok(json!({}))
                });
        });
    let core = Core::start(dist_with(vec![emitter], &["em"])).unwrap();
    call(&core, "em.go", json!({"n": 1})).unwrap();
    let e = call(&core, "em.go", json!({"n": "one"})).unwrap_err();
    assert_eq!(e.code, "internal");
    assert!(e.message.contains("declared schema"), "{}", e.message);

    let definer = t(json!({"id":"df","version":"1","requires":{"extension_points":["df.p"]},
        "defines":{"extension_points":[{"name":"df.p","policy":"single","methods":{"get":{"input":{"type":"object"},"output":{"type":"object","required":["v"],"properties":{"v":{"type":"integer"}}}}}}]},
        "contributes":{"ops":["df.ask"]}}),
        |a| {
            a.op(OpSpec::command("df.ask", "df.write", "ask", json!({"type":"object","additionalProperties":true,"properties":{}})),
                |_, input, svc| svc.extension_call("df.p", "get", input));
        });
    let provider = t(json!({"id":"pv","version":"1","provides":[{"extension_point":"df.p"}]}),
        |a| a.provide("df.p", "get", |input, _| Ok(input)));
    let core = Core::start(dist_with(vec![definer, provider], &["df", "pv"])).unwrap();
    assert_eq!(call(&core, "df.ask", json!({"v": 3})).unwrap()["v"], 3);
    let e = call(&core, "df.ask", json!({"v": "x"})).unwrap_err();
    assert!(e.message.contains("output schema"), "{}", e.message);
}
