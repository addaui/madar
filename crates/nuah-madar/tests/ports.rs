//! Plugin-defined ports: a plugin invents an extension point, others fill it.

use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};
use std::sync::Arc;

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
fn call(core: &Core, op: &str, input: Value) -> Result<Value> {
    core.call(CallRequest { op: op.into(), input, ..Default::default() }).map(|r| r.data)
}
fn problems(d: Distribution) -> String {
    match Core::start(d) {
        Ok(_) => panic!("should not start"),
        Err(p) => p.join("\n"),
    }
}

#[test]
fn completing_a_task_reaches_every_channel_and_each_keeps_its_own_data() {
    let core = start(memory_for_tests()).unwrap();
    let p = call(&core, "projects.create", json!({"name": "Home"})).unwrap();
    let task = call(&core, "tasks.create", json!({"project_id": p["id"], "title": "Pay rent"})).unwrap();
    assert_eq!(call(&core, "inbox.list", json!({})).unwrap().as_array().unwrap().len(), 0);
    call(&core, "tasks.update", json!({"id": task["id"], "status": "Done"})).unwrap();
    let inbox = call(&core, "inbox.list", json!({})).unwrap();
    assert_eq!(inbox[0]["title"], "Done: Pay rent");
    assert_eq!(call(&core, "notify.count", json!({})).unwrap()["count"], 1);
    // reopening and finishing again is a second message
    call(&core, "tasks.update", json!({"id": task["id"], "status": "Backlog"})).unwrap();
    assert_eq!(call(&core, "inbox.list", json!({})).unwrap().as_array().unwrap().len(), 1);
    call(&core, "tasks.update", json!({"id": task["id"], "status": "Done"})).unwrap();
    assert_eq!(call(&core, "notify.count", json!({})).unwrap()["count"], 2);
    assert_eq!(call(&core, "inbox.read", json!({})).unwrap()["marked"], 2);
    assert_eq!(call(&core, "inbox.list", json!({"unread": true})).unwrap().as_array().unwrap().len(), 0);
}

#[test]
fn one_channel_can_be_switched_off_without_the_others_noticing() {
    let core = start(memory_for_tests()).unwrap();
    core.disable("notify-count").unwrap();
    let p = call(&core, "projects.create", json!({"name": "Home"})).unwrap();
    let task = call(&core, "tasks.create", json!({"project_id": p["id"], "title": "x"})).unwrap();
    call(&core, "tasks.update", json!({"id": task["id"], "status": "Done"})).unwrap();
    assert_eq!(call(&core, "inbox.list", json!({})).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(call(&core, "notify.count", json!({})).unwrap_err().code, "unknown_op");
    // the definer cannot go while its channels are on
    assert!(core.disable("notify").unwrap_err().message.contains("notify.channel"));
}

fn broken_channel() -> Arc<dyn Plugin> {
    t(
        json!({"id":"notify-broken","version":"0.1.0","requires":{"ports":["db"]},"data":{"owns":["junk"]},
               "provides":[{"extension_point":"notify.channel","priority":1}],"contributes":{"ops":["broken.peek"]}}),
        |a| {
            a.provide("notify.channel", "deliver", |_i, svc| {
                svc.db()?.put("junk", "1", &json!({"x": 1}))?;
                Err(LinkError::new("db_error", "channel is down"))
            });
            a.op(OpSpec::query("broken.peek", "x.read", "", json!({})), |_c, _i, svc| {
                Ok(json!(svc.db()?.query(&Query::new("junk"))?.len()))
            });
        },
    )
}

#[test]
fn a_failing_channel_does_not_stop_the_others_and_leaves_nothing_behind() {
    let core = start(dist_with(vec![broken_channel()], &["notify-broken"])).unwrap();
    let p = call(&core, "projects.create", json!({"name": "Home"})).unwrap();
    let task = call(&core, "tasks.create", json!({"project_id": p["id"], "title": "x"})).unwrap();
    call(&core, "tasks.update", json!({"id": task["id"], "status": "Done"})).unwrap();
    assert_eq!(call(&core, "inbox.list", json!({})).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(call(&core, "broken.peek", json!({})).unwrap(), json!(0), "its partial write was rolled back");
}

fn greeter(id: &str, prio: i32, answer: Value) -> Arc<dyn Plugin> {
    t(
        json!({"id":id,"version":"0.1.0","provides":[{"extension_point":"greet.say","priority":prio}],"contributes":{"ops":[]}}),
        move |a| {
            let answer = answer.clone();
            a.provide("greet.say", "hello", move |_i, _s| Ok(answer.clone()));
        },
    )
}
fn greet_definer(policy: &str) -> Arc<dyn Plugin> {
    t(
        json!({"id":"greet","version":"0.1.0","requires":{"extension_points":["greet.say"]},
            "defines":{"extension_points":[{"name":"greet.say","policy":policy,"methods":{"hello":{"input":{"type":"object","required":["name"]},"readonly":true}}}]},
            "contributes":{"ops":["greet.run"]}}),
        |a| {
            a.op(OpSpec::query("greet.run", "x.read", "", json!({})), |_c, _i, svc| svc.extension_call("greet.say", "hello", json!({"name": "n"})));
        },
    )
}

#[test]
fn the_first_policy_takes_the_first_answer_in_priority_order() {
    let d = dist_with(vec![greet_definer("first"), greeter("g1", 1, Value::Null), greeter("g2", 2, json!("from g2")), greeter("g3", 3, json!("from g3"))], &["greet", "g1", "g2", "g3"]);
    let core = start(d).unwrap();
    assert_eq!(call(&core, "greet.run", json!({})).unwrap(), json!("from g2"));
    core.disable("g2").unwrap();
    assert_eq!(call(&core, "greet.run", json!({})).unwrap(), json!("from g3"));
    core.disable("g3").unwrap();
    assert_eq!(call(&core, "greet.run", json!({})).unwrap(), Value::Null);
}

#[test]
fn the_single_policy_needs_exactly_one_provider_and_the_operator_picks() {
    let two = || vec![greet_definer("single"), greeter("g1", 0, json!("one")), greeter("g2", 0, json!("two"))];
    let msg = problems(dist_with(two(), &["greet", "g1", "g2"]));
    assert!(msg.contains("ambiguous") && msg.contains("greet.say"), "{msg}");
    let mut d = dist_with(two(), &["greet", "g1", "g2"]);
    d.bindings.insert("greet.say".into(), "g2".into());
    let core = start(d).unwrap();
    assert_eq!(call(&core, "greet.run", json!({})).unwrap(), json!("two"));
    // the bound provider cannot be pulled out from under its users
    assert!(core.disable("g2").is_err());
    let msg = problems(dist_with(vec![greet_definer("single")], &["greet"]));
    assert!(msg.contains("no provider"), "{msg}");
}

#[test]
fn the_resolver_names_every_mistake_in_a_port_definition() {
    let bad_name = t(
        json!({"id":"bad","version":"0.1.0","defines":{"extension_points":[{"name":"other.thing","methods":{"m":{}}},{"name":"bad.p","policy":"sideways","methods":{"m":{}}},{"name":"bad.empty","methods":{}}]},"contributes":{"ops":[]}}),
        |_| {},
    );
    let msg = problems(dist_with(vec![bad_name], &["bad"]));
    assert!(msg.contains("must start with `bad.`"), "{msg}");
    assert!(msg.contains("unknown policy `sideways`"), "{msg}");
    assert!(msg.contains("has no methods"), "{msg}");

    let orphan = t(json!({"id":"orphan","version":"0.1.0","provides":[{"extension_point":"nobody.defines"}],"requires":{"extension_points":["nobody.else"]},"contributes":{"ops":[]}}), |_| {});
    let msg = problems(dist_with(vec![orphan], &["orphan"]));
    assert!(msg.contains("which no enabled plugin defines") && msg.contains("requires unknown extension point `nobody.else`"), "{msg}");

    let lazy = t(json!({"id":"lazy","version":"0.1.0","provides":[{"extension_point":"greet.say"}],"contributes":{"ops":[]}}), |_| {});
    let msg = problems(dist_with(vec![greet_definer("many"), lazy], &["greet", "lazy"]));
    assert!(msg.contains("did not fill method `hello`"), "{msg}");

    let extra = t(json!({"id":"extra","version":"0.1.0","contributes":{"ops":[]}}), |a| a.provide("greet.say", "hello", |_i, _s| Ok(json!(1))));
    let msg = problems(dist_with(vec![greet_definer("many"), extra], &["greet", "extra"]));
    assert!(msg.contains("does not provide that port method"), "{msg}");
}

#[test]
fn port_input_is_checked_and_a_plugin_must_ask_for_the_port() {
    let sneaky = t(
        json!({"id":"sneaky","version":"0.1.0","requires":{"ports":[]},"contributes":{"ops":["sneaky.go"]}}),
        |a| a.op(OpSpec::query("sneaky.go", "x.read", "", json!({})), |_c, _i, svc| svc.extension_call("greet.say", "hello", json!({"name": "x"}))),
    );
    let bad_input = t(
        json!({"id":"badin","version":"0.1.0","requires":{"extension_points":["greet.say"]},"contributes":{"ops":["badin.go"]}}),
        |a| a.op(OpSpec::query("badin.go", "x.read", "", json!({})), |_c, _i, svc| svc.extension_call("greet.say", "hello", json!({}))),
    );
    let core = start(dist_with(vec![greet_definer("many"), greeter("g1", 0, json!(1)), sneaky, bad_input], &["greet", "g1", "sneaky", "badin"])).unwrap();
    assert_eq!(call(&core, "sneaky.go", json!({})).unwrap_err().code, "capability_denied");
    assert_eq!(call(&core, "badin.go", json!({})).unwrap_err().code, "invalid_input");
}

#[test]
fn queries_cannot_call_port_methods_that_change_data() {
    let definer = t(
        json!({"id":"ch","version":"0.1.0","requires":{"extension_points":["ch.w"]},
            "defines":{"extension_points":[{"name":"ch.w","policy":"many","methods":{"write":{}}}]},"contributes":{"ops":["ch.read","ch.write"]}}),
        |a| {
            a.op(OpSpec::query("ch.read", "x.read", "", json!({})), |_c, _i, svc| svc.extension_call("ch.w", "write", json!({})));
            a.op(OpSpec::command("ch.write", "x.write", "", json!({})), |_c, _i, svc| svc.extension_call("ch.w", "write", json!({})));
        },
    );
    let prov = t(json!({"id":"chp","version":"0.1.0","provides":[{"extension_point":"ch.w"}],"contributes":{"ops":[]}}), |a| a.provide("ch.w", "write", |_i, _s| Ok(json!("ok"))));
    let core = start(dist_with(vec![definer, prov], &["ch", "chp"])).unwrap();
    assert_eq!(call(&core, "ch.read", json!({})).unwrap_err().code, "conflict");
    assert_eq!(call(&core, "ch.write", json!({})).unwrap()[0]["data"], "ok");
}

#[test]
fn describe_lists_extension_points_with_their_providers() {
    let core = start(memory_for_tests()).unwrap();
    let d = core.describe(None, None);
    let ep = d["extension_points"].as_array().unwrap();
    assert_eq!(ep.len(), 1);
    assert_eq!(ep[0]["name"], "notify.channel");
    assert_eq!(ep[0]["policy"], "many");
    assert_eq!(ep[0]["providers"], json!(["notify-inbox", "notify-count"]));
}

#[test]
fn a_first_provider_that_declines_leaves_nothing_behind() {
    let decliner = t(
        json!({"id":"dec","version":"0.1.0","requires":{"ports":["db"]},"data":{"owns":["dec_data"]},"provides":[{"extension_point":"greet.say","priority":1}],"contributes":{"ops":["dec.peek"]}}),
        |a| {
            a.provide("greet.say", "hello", |_i, svc| { svc.db()?.put("dec_data", "1", &json!({"x": 1}))?; Ok(Value::Null) });
            a.op(OpSpec::query("dec.peek", "x.read", "", json!({})), |_c, _i, svc| Ok(json!(svc.db()?.query(&Query::new("dec_data"))?.len())));
        },
    );
    let core = start(dist_with(vec![greet_definer("first"), decliner, greeter("g2", 2, json!("yes"))], &["greet", "dec", "g2"])).unwrap();
    assert_eq!(call(&core, "greet.run", json!({})).unwrap(), json!("yes"));
    assert_eq!(call(&core, "dec.peek", json!({})).unwrap(), json!(0));
}

#[test]
fn names_that_would_break_generated_code_are_refused_at_start() {
    let evil = t(json!({"id":"evil","version":"0.1.0","contributes":{"ops":["w.a(){}};x"]}}), |_| {});
    assert!(problems(dist_with(vec![evil], &["evil"])).contains("lowercase words"));
    let a = t(json!({"id":"aa","version":"0.1.0","contributes":{"ops":["aa.b_c","aa.bC"]}}), |_| {});
    let msg = problems(dist_with(vec![a], &["aa"]));
    assert!(msg.contains("lowercase words") || msg.contains("same method name"), "{msg}");
    let x = t(json!({"id":"xx","version":"0.1.0","contributes":{"ops":["xx.a_b","xx_a.b"]}}), |_| {});
    assert!(problems(dist_with(vec![x], &["xx"])).contains("same"));
    let spoof = t(json!({"id":"spoof","version":"0.1.0","requires":{"capabilities":["events"]},"contributes":{"ops":[],"events":["task.updated"]}}), |_| {});
    assert!(problems(dist_with(vec![spoof], &["spoof"])).contains("only one plugin may emit a kind"));
    let mut d = memory_for_tests();
    d.bindings.insert("notify.channel".into(), "notify-inbox".into());
    assert!(problems(d).contains("not a `single` port"));
}

#[test]
fn a_bound_single_provider_can_go_when_nobody_needs_the_port() {
    let mut d = dist_with(vec![greet_definer("single"), greeter("g1", 0, json!("one"))], &["greet", "g1"]);
    d.bindings.insert("greet.say".into(), "g1".into());
    let core = start(d).unwrap();
    assert!(core.disable("g1").is_err(), "greet requires the port");
    core.disable("greet").unwrap_err(); // g1 provides what greet defines
}

#[test]
fn queries_cannot_write_even_to_their_own_collections() {
    let sneaky = t(
        json!({"id":"qw","version":"0.1.0","requires":{"ports":["db"]},"data":{"owns":["qw_data"]},"contributes":{"ops":["qw.read"]}}),
        |a| a.op(OpSpec::query("qw.read", "x.read", "", json!({})), |_c, _i, svc| { svc.db()?.put("qw_data", "1", &json!({"x": 1}))?; Ok(json!(null)) }),
    );
    let core = start(dist_with(vec![sneaky], &["qw"])).unwrap();
    assert_eq!(call(&core, "qw.read", json!({})).unwrap_err().code, "conflict");
}
