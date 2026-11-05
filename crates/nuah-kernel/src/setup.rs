//! What a setup wizard needs, without starting anything: the resolver's problems as data, and the
//! catalog as plain JSON (what each plugin is, needs, provides and lets you set).

use crate::core::Distribution;
use crate::ports::PORT_NAMES;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

/// One thing the resolver objects to. `message` is the text an operator reads; `code` says what
/// kind of problem it is and `plugins` which plugins it is about, so a face can put it next to the
/// right control instead of in one long list.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Problem {
    pub code: String,
    pub plugins: Vec<String>,
    pub message: String,
}

impl Problem {
    /// The resolver's messages are the single source of truth; the kind and the plugins involved are
    /// read back from them (plugin ids are always written in backticks).
    pub fn from_message(msg: &str, known_plugins: &HashSet<String>) -> Problem {
        const KINDS: &[(&str, &str)] = &[
            ("is not in the catalog", "unknown_plugin"),
            ("is listed twice", "duplicate_plugin"),
            ("share the id", "duplicate_plugin"),
            ("needs runtime", "unsupported_runtime"),
            ("has no adapter", "missing_provider"),
            ("has no provider", "missing_provider"),
            ("is ambiguous", "ambiguous_binding"),
            ("is bound to", "bad_binding"),
            ("binding for", "bad_binding"),
            ("chosen for only some", "bad_binding"),
            ("which is not enabled", "missing_dependency"),
            ("but `", "version_mismatch"),
            ("settings of plugin", "bad_settings"),
            ("cycle", "bad_order"),
            ("orders itself", "bad_order"),
            ("unknown port", "unknown_reference"),
            ("unknown capability", "unknown_reference"),
            ("which no enabled plugin defines", "unknown_reference"),
            ("owned by both", "conflict"),
            ("declared by both", "conflict"),
            ("defined twice", "conflict"),
            ("defined by both", "conflict"),
            ("asks for an index", "bad_index"),
            ("same method name", "bad_name"),
            ("same agent tool name", "bad_name"),
            ("names are lowercase", "bad_name"),
        ];
        let code = KINDS.iter().find(|(needle, _)| msg.contains(needle)).map(|(_, c)| *c).unwrap_or("other");
        let mut plugins: Vec<String> = vec![];
        // Ids appear in backticks, or in a parenthesised candidate list: "(adapter-a, adapter-b)".
        let mut mentioned: Vec<&str> = msg.split('`').enumerate().filter(|(i, _)| i % 2 == 1).map(|(_, p)| p).collect();
        for (i, part) in msg.split(|c| c == '(' || c == ')').enumerate() {
            if i % 2 == 1 {
                mentioned.extend(part.split(", "));
            }
        }
        for part in mentioned {
            if known_plugins.contains(part) && !plugins.iter().any(|p| p == part) {
                plugins.push(part.to_string());
            }
        }
        Problem { code: code.to_string(), plugins, message: msg.to_string() }
    }
}

/// The catalog and the current choices, as JSON for a setup face. Reads manifests only.
pub fn catalog_info(dist: &Distribution) -> Value {
    let mut plugins: Vec<Value> = dist
        .catalog
        .iter()
        .map(|p| {
            let m = p.manifest();
            json!({
                "id": m.id, "version": m.version, "description": m.description, "kind": m.kind, "quality": m.quality,
                "runtime": m.runtime, "profiles": m.profiles,
                "implements": m.implements.iter().map(|i| &i.port).collect::<Vec<_>>(),
                "defines": m.defines.ports.iter().map(|d| json!({"name": d.name, "policy": d.policy})).collect::<Vec<_>>(),
                "provides": m.provides.iter().map(|p| &p.port).collect::<Vec<_>>(),
                "requires": {"plugins": m.requires.plugins, "ports": m.requires.ports},
                "settings_schema": m.settings_schema,
                "enabled": dist.enabled.contains(&m.id),
                "settings": dist.settings.get(&m.id).cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    plugins.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    json!({
        "profile": {"name": dist.name, "enabled": dist.enabled, "bindings": dist.bindings, "settings": dist.settings},
        "core_ports": PORT_NAMES,
        "plugins": plugins,
    })
}

/// Read a profile: {"name", "enabled": [...], "bindings": {port: plugin}, "settings": {plugin: {...}}}.
/// Wrong shapes are reported, not ignored, so a typo in a profile file does not silently turn a
/// plugin off.
pub fn distribution_from_json(catalog: Vec<std::sync::Arc<dyn crate::plugin::Plugin>>, v: &Value) -> std::result::Result<Distribution, String> {
    let obj = v.as_object().ok_or("a profile must be a JSON object")?;
    for k in obj.keys() {
        if !["name", "enabled", "bindings", "settings"].contains(&k.as_str()) {
            return Err(format!("profile has an unknown key `{k}` (known: name, enabled, bindings, settings)"));
        }
    }
    let name = v["name"].as_str().filter(|n| !n.trim().is_empty()).ok_or("profile needs a `name`")?.to_string();
    let enabled = match obj.get("enabled") {
        None => vec![],
        Some(Value::Array(a)) => a.iter().map(|x| x.as_str().map(String::from).ok_or("`enabled` must be a list of plugin ids")).collect::<std::result::Result<Vec<_>, _>>()?,
        Some(_) => return Err("`enabled` must be a list of plugin ids".into()),
    };
    let bindings = match obj.get("bindings") {
        None => Default::default(),
        Some(Value::Object(o)) => o.iter().map(|(k, x)| x.as_str().map(|s| (k.clone(), s.to_string())).ok_or(format!("binding for `{k}` must be a plugin id"))).collect::<std::result::Result<_, _>>()?,
        Some(_) => return Err("`bindings` must be an object of port to plugin id".into()),
    };
    let settings = match obj.get("settings") {
        None => Default::default(),
        Some(Value::Object(o)) => o.iter().map(|(k, x)| (k.clone(), x.clone())).collect(),
        Some(_) => return Err("`settings` must be an object of plugin id to settings".into()),
    };
    Ok(Distribution { name, catalog, enabled, bindings, settings })
}

/// The profile as JSON, in the shape `distribution_from_json` reads.
pub fn profile_json(dist: &Distribution) -> Value {
    let bindings: std::collections::BTreeMap<_, _> = dist.bindings.iter().collect();
    let settings: std::collections::BTreeMap<_, _> = dist.settings.iter().collect();
    json!({"name": dist.name, "enabled": dist.enabled, "bindings": bindings, "settings": settings})
}
