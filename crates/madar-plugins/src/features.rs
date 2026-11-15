// SPDX-License-Identifier: Apache-2.0
//! `@madar/features` ([ADR 0080]): the Owner switches, replaces and configures the **feature** plugins of the instance from the
//! product's settings, and never touches a **platform** plugin.
//!
//! The Face is never the authority. Every call asks the shell for the catalog, reads each plugin's class **as the Core worked it out
//! from the Manifest** (nothing in the input names a class), and refuses a platform plugin with `features.platform_plugin`. A change is
//! a draft of the identity file that touches one plugin's entry only: its `enabled` flag, its settings, and the Capabilities it asks
//! for (a feature asks only for the safe ones, so granting them is what enabling means). It is saved only if it resolves, and the
//! old file stays beside it. The code of a plugin is never added here: the catalog is fixed by the operator.
//!
//! Operations (all outbound, because they reach the shell; the plugin needs the Capability `shell`, which makes it a platform plugin
//! itself, so no Owner can switch it off from here):
//!
//!   features.list        every plugin of the catalog with its class, state and (for features) its settings form
//!   features.enable      switch a feature on, with the features it requires
//!   features.disable     switch a feature off (names what needs it; `cascade` switches those off too)
//!   features.configure   change a feature's settings
//!   features.replace     swap one provider of an extension point for another
//!   features.apply       ask the instance to start again with the saved file
//!
//! [ADR 0080]: https://docs.addaui.com/nuah/adr/0080-two-kinds-of-plugin-platform-plugins-are-for-the-operator-feature-plugins-are-for-the-owner-and-the-line-is-what-the-plugin-provides/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Map, Value};
use std::sync::Arc;

pub struct Features;

fn shell(cx: &Outbound) -> Result<Arc<dyn ShellServices>> {
    cx.shell().map_err(|_| Error::reason(Category::Denied, "features.no_shell", "This instance does not let the app change its configuration (the program running it offers no shell services)"))
}

fn plugin<'a>(state: &'a Value, id: &str) -> Result<&'a Value> {
    state["plugins"].as_array().and_then(|l| l.iter().find(|p| p["id"] == id)).ok_or_else(|| Error::not_found(&format!("plugin {id}")))
}

/// The class the Core worked out; anything it did not say is platform, the safe side.
fn is_feature(p: &Value) -> bool {
    p["class"]["class"] == "feature"
}

fn must_be_feature(state: &Value, id: &str) -> Result<()> {
    if is_feature(plugin(state, id)?) {
        return Ok(());
    }
    let why = plugin(state, id)?["class"]["reasons"].as_array().map(|r| r.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("; ")).unwrap_or_default();
    Err(Error::reason(Category::Denied, "features.platform_plugin", &format!("{id} belongs to the operator ({why}). Ask the operator to change it in the console.")))
}

/// The stored Profile as the shell shows it, ready to be changed and sent back as a draft.
fn profile_of(state: &Value) -> Value {
    let mut p = state["profile"].clone();
    if !p.is_object() {
        p = json!({});
    }
    if !p["plugins"].is_object() {
        p["plugins"] = json!({});
    }
    p
}

fn entry<'a>(profile: &'a mut Value, id: &str) -> &'a mut Map<String, Value> {
    let plugins = profile["plugins"].as_object_mut().expect("plugins is an object");
    plugins.entry(id.to_string()).or_insert_with(|| json!({"enabled": false})).as_object_mut().expect("an entry is an object")
}

fn problems_error(problems: &[Problem]) -> Error {
    let text = problems.iter().map(|p| p.message.as_str()).collect::<Vec<_>>().join(" ");
    Error::reason(Category::Invalid, "features.problems", &text)
}

/// Check the draft, save it if it resolves, and say a restart is needed.
fn commit(cx: &Outbound, sh: &Arc<dyn ShellServices>, draft: &Value, what: &str, ids: &[&str]) -> Result<Value> {
    let problems = sh.save(draft).map_err(Error::internal)?;
    if !problems.is_empty() {
        return Err(problems_error(&problems));
    }
    cx.log(Level::Info, "features.saved", json!({"by": cx.who().subject, "what": what, "plugins": ids}));
    Ok(json!({"saved": true, "restart_required": true}))
}

/// The plugin and, when it is being switched on, the plugins it requires that are still off (all must be features: a platform plugin
/// that is off is for the operator to switch on, and the call says so).
fn with_dependencies(state: &Value, id: &str) -> Result<Vec<String>> {
    let enabled = |i: &str| state["profile"]["plugins"][i]["enabled"] == true;
    let mut out = vec![];
    let mut todo = vec![id.to_string()];
    while let Some(next) = todo.pop() {
        if out.contains(&next) {
            continue;
        }
        must_be_feature(state, &next)?;
        for dep in plugin(state, &next)?["requires"]["plugins"].as_array().cloned().unwrap_or_default() {
            let dep = dep.as_str().unwrap_or("").to_string();
            if !enabled(&dep) {
                todo.push(dep);
            }
        }
        out.push(next);
    }
    Ok(out)
}

fn switch(cx: &Outbound, id: &str, on: bool, cascade: bool) -> Result<Value> {
    let sh = shell(cx)?;
    let state = sh.state().map_err(Error::internal)?;
    must_be_feature(&state, id)?;
    let mut draft = profile_of(&state);
    let ids = if on { with_dependencies(&state, id)? } else { with_dependents(&state, id, cascade)? };
    for one in &ids {
        if on {
            // A feature asks only for the safe Capabilities, so the Owner's switch grants them.
            let wanted: Vec<Value> = plugin(&state, one)?["requires"]["capabilities"].as_array().cloned().unwrap_or_default();
            let e = entry(&mut draft, one);
            e.insert("enabled".into(), json!(true));
            if !wanted.is_empty() {
                e.insert("grants".into(), json!(wanted));
            }
        } else {
            entry(&mut draft, one).insert("enabled".into(), json!(false));
        }
    }
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut out = commit(cx, &sh, &draft, if on { "enabled" } else { "disabled" }, &refs)?;
    out["changed"] = json!(ids);
    Ok(out)
}

/// The plugin and the enabled plugins that stop working without it: those that require it by id, and those that need an extension
/// point it was the last provider of (and so on, until nothing more falls). Without `cascade` a dependent is a refusal that names them.
fn with_dependents(state: &Value, id: &str, cascade: bool) -> Result<Vec<String>> {
    let all = state["plugins"].as_array().cloned().unwrap_or_default();
    let enabled = |p: &Value| state["profile"]["plugins"][p["id"].as_str().unwrap_or("")]["enabled"] == true;
    let strs = |v: &Value| -> Vec<String> { v.as_array().cloned().unwrap_or_default().iter().filter_map(|x| x.as_str().map(String::from)).collect() };
    let mut off: Vec<String> = vec![id.to_string()];
    loop {
        let mut grew = false;
        for q in all.iter().filter(|q| enabled(q)) {
            let qid = q["id"].as_str().unwrap_or("").to_string();
            if off.contains(&qid) {
                continue;
            }
            let by_id = strs(&q["requires"]["plugins"]).iter().any(|d| off.contains(d));
            let by_point = strs(&q["requires"]["extension_points"]).iter().any(|point| {
                let provides = |p: &Value| strs(&p["provides"]).contains(point);
                all.iter().any(|p| off.contains(&p["id"].as_str().unwrap_or("").to_string()) && provides(p)) && !all.iter().any(|p| enabled(p) && !off.contains(&p["id"].as_str().unwrap_or("").to_string()) && provides(p))
            });
            if by_id || by_point {
                off.push(qid);
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }
    let others: Vec<&String> = off.iter().filter(|o| *o != id).collect();
    if !others.is_empty() && !cascade {
        let names = others.iter().map(|o| o.as_str()).collect::<Vec<_>>().join(", ");
        return Err(Error::reason(Category::Conflict, "features.needed_by", &format!("{id} is needed by {names}. Switching it off switches those off too; confirm to do both.")));
    }
    for o in &off {
        must_be_feature(state, o)?;
    }
    Ok(off)
}

impl Plugin for Features {
    fn manifest(&self) -> Manifest {
        let id = json!({"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false});
        let saved = json!({"type":"object","required":["saved","restart_required"],"properties":{"saved":{"type":"boolean"},"restart_required":{"type":"boolean"},"changed":{"type":"array","items":{"type":"string"}}}});
        let reasons = json!({
            "features.platform_plugin": "This plugin belongs to the operator; change it in the console",
            "features.problems": "The change would leave the instance unable to start; nothing was saved",
            "features.needed_by": "Other features need this one; switching it off switches them off too, and the call must confirm with cascade",
            "features.no_shell": "This instance does not let the app change its configuration"
        });
        manifest(json!({
            "id": "@madar/features", "version": "0.1.0", "name": "Features", "namespaces": ["features"],
            "description": "The Owner switches, replaces and configures the feature plugins of this instance; platform plugins stay with the operator",
            "requires": {"capabilities": ["shell"]},
            "permissions": {"features.manage": {"description": "Switch, replace and configure feature plugins", "default": ["admin", "owner"]}},
            "operations": {
                "features.list": {"kind": "outbound", "permission": "features.manage", "description": "Every plugin of the catalog with its class and state; a feature also has its settings form.",
                    "reasons": {"features.no_shell": "This instance does not let the app change its configuration"},
                    "output": {"type":"object","required":["features","platform"],"properties":{
                        "features":{"type":"array","items":{"type":"object","required":["id","kind","name","description","enabled","needs","provides"],"properties":{
                            "id":{"type":"string"},"kind":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"version":{"type":"string"},"enabled":{"type":"boolean"},
                            "needs":{"type":"array","items":{"type":"string"}},"provides":{"type":"array","items":{"type":"string"}},
                            "defines":{"type":"array","items":{"type":"object","required":["name","policy"],"properties":{"name":{"type":"string"},"policy":{"type":"string"}}}},
                            "settings_schema":{"type":["object","null"]},"settings":{"type":["object","null"]}}}},
                        "platform":{"type":"array","items":{"type":"object","required":["id","name","enabled","reasons"],"properties":{
                            "id":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"enabled":{"type":"boolean"},"reasons":{"type":"array","items":{"type":"string"}}}}}}}},
                "features.enable": {"kind": "outbound", "permission": "features.manage", "description": "Switch a feature plugin on.", "input": id, "reasons": reasons, "output": saved},
                "features.disable": {"kind": "outbound", "permission": "features.manage", "description": "Switch a feature plugin off. When other features need it the call is refused and names them, unless it confirms with `cascade`, which switches them off too.",
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"},"cascade":{"type":"boolean"}},"additionalProperties":false}, "reasons": reasons, "output": saved},
                "features.configure": {"kind": "outbound", "permission": "features.manage", "description": "Change the settings of a feature plugin.", "reasons": reasons, "output": saved,
                    "input": {"type":"object","required":["id","settings"],"properties":{"id":{"type":"string"},"settings":{"type":"object"}},"additionalProperties":false}},
                "features.replace": {"kind": "outbound", "permission": "features.manage", "description": "Swap one provider of an extension point for another, both feature plugins.", "reasons": reasons, "output": saved,
                    "input": {"type":"object","required":["from","to"],"properties":{"from":{"type":"string"},"to":{"type":"string"}},"additionalProperties":false}},
                "features.apply": {"kind": "outbound", "permission": "features.manage", "description": "Start the instance again with the saved file, so the changes show.", "reasons": reasons,
                    "output": {"type":"object","required":["restarting"],"properties":{"restarting":{"type":"boolean"}}}}
            }
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.outbound("features.list", |cx, _| {
            let state = shell(cx)?.state().map_err(Error::internal)?;
            let enabled = |id: &str| state["profile"]["plugins"][id]["enabled"] == true;
            let (mut features, mut platform) = (vec![], vec![]);
            for p in state["plugins"].as_array().cloned().unwrap_or_default() {
                let id = p["id"].as_str().unwrap_or("");
                if is_feature(&p) {
                    features.push(json!({
                        "id": id, "kind": p["kind"], "name": p["name"], "description": p["description"], "version": p["version"], "enabled": enabled(id),
                        "needs": p["requires"]["plugins"], "provides": p["provides"], "defines": p["defines"],
                        "settings_schema": p["settings_schema"], "settings": state["profile"]["plugins"][id]["settings"]
                    }));
                } else {
                    platform.push(json!({"id": id, "name": p["name"], "description": p["description"], "enabled": enabled(id), "reasons": p["class"]["reasons"]}));
                }
            }
            Ok(json!({"features": features, "platform": platform}))
        });
        b.outbound("features.enable", |cx, i| switch(cx, text(&i, "id"), true, false));
        b.outbound("features.disable", |cx, i| switch(cx, text(&i, "id"), false, i["cascade"] == true));
        b.outbound("features.configure", |cx, i| {
            let (sh, id) = (shell(cx)?, text(&i, "id"));
            let state = sh.state().map_err(Error::internal)?;
            must_be_feature(&state, id)?;
            let mut draft = profile_of(&state);
            entry(&mut draft, id).insert("settings".into(), i["settings"].clone());
            commit(cx, &sh, &draft, "configured", &[id])
        });
        b.outbound("features.replace", |cx, i| {
            let (sh, from, to) = (shell(cx)?, text(&i, "from"), text(&i, "to"));
            let state = sh.state().map_err(Error::internal)?;
            must_be_feature(&state, from)?;
            must_be_feature(&state, to)?;
            let points = |id: &str| -> Vec<String> { plugin(&state, id).ok().and_then(|p| p["provides"].as_array().cloned()).unwrap_or_default().iter().filter_map(|x| x.as_str().map(String::from)).collect() };
            // Only a point that takes one provider can be swapped; several providers of a shared point are all on together.
            let single: Vec<String> = state["plugins"].as_array().cloned().unwrap_or_default().iter().flat_map(|p| p["defines"].as_array().cloned().unwrap_or_default()).filter(|d| d["policy"] == "single").filter_map(|d| d["name"].as_str().map(String::from)).collect();
            if !points(from).iter().any(|p| single.contains(p) && points(to).contains(p)) {
                return Err(Error::invalid("to", &format!("{to} does not provide a point that takes one provider and that {from} provides, so it cannot replace it")));
            }
            let wanted: Vec<Value> = plugin(&state, to)?["requires"]["capabilities"].as_array().cloned().unwrap_or_default();
            let mut draft = profile_of(&state);
            entry(&mut draft, from).insert("enabled".into(), json!(false));
            let e = entry(&mut draft, to);
            e.insert("enabled".into(), json!(true));
            if !wanted.is_empty() {
                e.insert("grants".into(), json!(wanted));
            }
            commit(cx, &sh, &draft, "replaced", &[from, to])
        });
        b.outbound("features.apply", |cx, _| {
            let sh = shell(cx)?;
            cx.log(Level::Warn, "features.apply", json!({"by": cx.who().subject}));
            sh.restart();
            Ok(json!({"restarting": true}))
        });
    }
}
