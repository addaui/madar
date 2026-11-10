// SPDX-License-Identifier: Apache-2.0
//! PRD criterion 1: the same scenario through the in-process Link and through HTTP gives identical
//! answers (ids and times included, because both Cores use the same fixed clock and sequential ids).

use nuah_adapters::{FixedClock, TestClock, TestIds};
use nuah_kernel::Core;
use madar_plugins::{distribution_with, profile_test};
use serde_json::{json, Value};
use std::sync::{mpsc, Arc};

fn core() -> Core {
    let clock = FixedClock::at(1_700_000_000_000);
    let dist = distribution_with(profile_test(&[]), vec![Arc::new(TestClock(clock)), Arc::new(TestIds)]);
    Core::start(&dist).unwrap_or_else(|p| panic!("{p:#?}"))
}

/// A scenario as (operation, input) pairs; a later input may name an earlier answer with "$N.path".
fn scenario() -> Vec<(&'static str, Value)> {
    vec![
        ("projects.create", json!({"name": "Home"})),
        ("tasks.create", json!({"project": "$0.id", "title": "Pay rent", "priority": 8})),
        ("tasks.create", json!({"project": "$0.id", "title": "Water plants"})),
        ("tasks.move", json!({"project": "$0.id", "id": "$2.id", "status": "doing", "after": null})),
        ("tasks.update", json!({"project": "$0.id", "id": "$1.id", "priority": 5})),
        ("discussion.add", json!({"project": "$0.id", "task": "$1.id", "body": "done by phone"})),
        ("tasks.list", json!({"project": "$0.id", "status": "doing"})),
        ("tasks.update", json!({"project": "$0.id", "id": "$1.id", "title": ""})),
        ("tasks.get", json!({"project": "$0.id", "id": "nope"})),
        ("export.project", json!({"project": "$0.id"})),
        ("projects.list", json!({})),
    ]
}

fn fill(v: &Value, seen: &[Value]) -> Value {
    match v {
        Value::String(s) if s.starts_with('$') => {
            let (n, path) = s[1..].split_once('.').unwrap();
            seen[n.parse::<usize>().unwrap()][path].clone()
        }
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, seen))).collect()),
        x => x.clone(),
    }
}

/// What a Face sees: the output, or the category, key and reason of the refusal.
fn shape_error(category: &str, key: &str, reason: Option<&Value>, field: Option<&Value>) -> Value {
    json!({"error": {"category": category, "key": key, "reason": reason, "field": field}})
}

#[test]
fn the_same_scenario_gives_the_same_answers_in_process_and_over_http() {
    let local = core();
    let me = local.authenticate(None).expect("auth-local signs in without a credential");
    let mut in_process: Vec<Value> = vec![];
    let mut seen: Vec<Value> = vec![];
    for (op, input) in scenario() {
        let input = fill(&input, &seen);
        match local.call_as(&me, op, input, None) {
            Ok(r) => {
                seen.push(r.output.clone());
                in_process.push(r.output);
            }
            Err(e) => {
                seen.push(Value::Null);
                in_process.push(shape_error(serde_json::to_value(e.category).unwrap().as_str().unwrap(), &e.key, e.reason.as_ref().map(|r| json!(r)).as_ref(), e.params.get("field")));
            }
        }
    }

    let remote = core();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(l.local_addr().unwrap()).unwrap();
            axum::serve(l, nuah_http::router(remote, Default::default())).await.unwrap();
        });
    });
    let base = format!("http://{}", rx.recv().unwrap());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut over_http: Vec<Value> = vec![];
    let mut seen: Vec<Value> = vec![];
    for (op, input) in scenario() {
        let input = fill(&input, &seen);
        let mut resp = agent.post(&format!("{base}/link/call/{op}")).header("X-Nuah-Face", "parity").header("Content-Type", "application/json").send(serde_json::to_vec(&input).unwrap()).unwrap();
        let ok = resp.status().is_success();
        let body: Value = resp.body_mut().read_json().unwrap();
        if ok {
            seen.push(body["output"].clone());
            over_http.push(body["output"].clone());
        } else {
            let e = &body["error"];
            seen.push(Value::Null);
            over_http.push(shape_error(e["category"].as_str().unwrap_or("?"), e["key"].as_str().unwrap_or("?"), e.get("reason"), e["params"].get("field")));
        }
    }

    assert_eq!(in_process.len(), over_http.len());
    for (i, (a, b)) in in_process.iter().zip(&over_http).enumerate() {
        assert_eq!(a, b, "step {i} ({}) differs between the in-process Link and HTTP", scenario()[i].0);
    }
    // The scenario really exercised both a success and refusals.
    assert!(in_process.iter().any(|v| v.get("error").is_some()));
    assert_eq!(in_process[6]["tasks"].as_array().map(|t| t.len()), Some(1));
}
