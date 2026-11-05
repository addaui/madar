//! `around` hooks: nesting, short-circuit, input and output changes, recovery with rollback.

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
fn start_with(extra: Vec<Arc<dyn Plugin>>, enable: &[&str]) -> Core {
    let mut d = memory_for_tests();
    d.catalog.extend(extra);
    d.enabled.extend(enable.iter().map(|s| s.to_string()));
    Core::start(d).unwrap()
}
fn call(core: &Core, op: &str, input: Value) -> Result<Value> {
    core.call(CallRequest { op: op.into(), input, ..Default::default() }).map(|r| r.data)
}
type Log = Arc<Mutex<Vec<String>>>;
fn logger(id: &'static str, order: Value, log: Log) -> Arc<dyn Plugin> {
    t(json!({"id": id, "version":"1", "order": order}), move |a| {
        let (l1, l2, l3) = (log.clone(), log.clone(), log.clone());
        a.before(id, "projects.create", 0, move |_, _, _, _| { l1.lock().unwrap().push(format!("before {id}")); Ok(()) });
        a.around(id, "projects.create", 0, move |_, _, input, _, next| {
            l2.lock().unwrap().push(format!("in {id}"));
            let r = next.call(input);
            l2.lock().unwrap().push(format!("out {id}"));
            r
        });
        a.after(id, "projects.create", 0, move |_, _, _, _, _| { l3.lock().unwrap().push(format!("after {id}")); Ok(()) });
    })
}

#[test]
fn around_hooks_nest_in_hook_order_between_before_and_after_hooks() {
    let log: Log = Default::default();
    let core = start_with(vec![logger("a", json!({}), log.clone()), logger("b", json!({"before": ["a"]}), log.clone())], &["a", "b"]);
    call(&core, "projects.create", json!({"name": "x"})).unwrap();
    assert_eq!(*log.lock().unwrap(), ["before b", "before a", "in b", "in a", "out a", "out b", "after b", "after a"]);
    let hooks = core.describe(None, None)["hooks"].clone();
    assert!(hooks.as_array().unwrap().iter().any(|h| h["phase"] == "around" && h["plugin"] == "b"), "{hooks}");
}

#[test]
fn an_around_hook_can_answer_instead_of_the_handler_and_change_what_goes_in_and_comes_out() {
    let ran = Arc::new(Mutex::new(0));
    let r = ran.clone();
    let p = t(json!({"id":"p","version":"1"}), move |a| {
        let r = r.clone();
        a.around("shout", "projects.create", 0, move |_, _, mut input, _, next| {
            let name = input["name"].as_str().unwrap().to_uppercase();
            input["name"] = json!(name);
            let mut out = next.call(input)?;
            out["via"] = json!("p");
            Ok(out)
        });
        a.around("fake", "projects.list", 0, move |_, _, _, _, _| { *r.lock().unwrap() += 1; Ok(json!([{"id": "fake"}])) });
        a.around("break", "projects.update", 0, |_, _, mut input, _, next| { input["name"] = json!(""); next.call(input) });
    });
    let core = start_with(vec![p], &["p"]);
    let made = call(&core, "projects.create", json!({"name": "quiet"})).unwrap();
    assert_eq!((made["name"].as_str(), made["via"].as_str()), (Some("QUIET"), Some("p")));
    assert_eq!(call(&core, "projects.list", json!({})).unwrap(), json!([{"id": "fake"}]));
    assert_eq!(*ran.lock().unwrap(), 1);
    let e = call(&core, "projects.update", json!({"id": made["id"], "name": "fine"})).unwrap_err();
    assert_eq!(e.code, "invalid_input", "an input the hook broke is checked against the schema: {e:?}");
}

#[test]
fn work_and_events_of_a_failed_link_are_undone_when_a_hook_recovers() {
    let doer = t(json!({"id":"doer","version":"1","requires":{"ports":["db"],"capabilities":["events"]},"data":{"owns":["things"]},
            "contributes":{"ops":["doer.go","doer.count"],"events":["doer.did"]}}), |a| {
        a.op(OpSpec::command("doer.go", "doer.write", "", json!({"type":"object","additionalProperties":true,"properties":{}})), |ctx, _, svc| {
            svc.db()?.put("things", "t1", &json!({"id": "t1"}))?;
            svc.emit("doer.did", &ctx.subject, json!({}))?;
            Err(LinkError::conflict("nope"))
        });
        a.op(OpSpec::query("doer.count", "doer.read", "", json!({"type":"object","additionalProperties":true,"properties":{}})), |_, _, svc| {
            Ok(json!(svc.db()?.query(&Query::new("things"))?.len()))
        });
    });
    let saver = t(json!({"id":"saver","version":"1","requires":{"capabilities":["events"]},"contributes":{"events":[]}}), |a| {
        a.around("recover", "doer.go", 0, |_, _, input, _, next| match next.call(input) {
            Err(e) if e.code == "conflict" => Ok(json!({"recovered": true})),
            other => other,
        });
    });
    let core = start_with(vec![doer, saver], &["doer", "saver"]);
    assert_eq!(call(&core, "doer.go", json!({})).unwrap(), json!({"recovered": true}));
    assert_eq!(call(&core, "doer.count", json!({})).unwrap(), json!(0), "the half-done write is gone");
    assert_eq!(core.latest_seq(), 0, "and so is its event");
}

#[test]
fn a_panicking_around_hook_is_an_internal_error_that_rolls_back() {
    let p = t(json!({"id":"p","version":"1"}), |a| {
        a.around("boom", "projects.create", 0, |_, _, input, _, next| { next.call(input)?; panic!("around bug") });
    });
    let core = start_with(vec![p], &["p"]);
    assert_eq!(call(&core, "projects.create", json!({"name": "x"})).unwrap_err().code, "internal");
    assert_eq!(call(&core, "projects.list", json!({})).unwrap(), json!([]), "the project made inside was rolled back");
}
