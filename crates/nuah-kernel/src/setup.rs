//! What a setup Face needs, without starting anything: the Catalog as plain data, a strict reader
//! for Profiles, and the secret handling of [ADR 0014].
//!
//! [ADR 0014]: https://docs.addaui.com/nuah/adr/0014-setup-wizard-is-a-separate-mode-with-a-setup-code-and-no-secrets/

use crate::resolver::{Distribution, Profile};
use crate::ports::PORTS;
use serde_json::{json, Map, Value};

const PROFILE_KEYS: [&str; 6] = ["name", "enabled", "bindings", "settings", "grants", "permissions"];

/// Read a Profile strictly: an unknown key or a wrong shape is an error, so a typo does not
/// silently switch a plugin off.
pub fn profile_from_json(v: &Value) -> Result<Profile, String> {
    let obj = v.as_object().ok_or("a profile must be a JSON object")?;
    for k in obj.keys() {
        if !PROFILE_KEYS.contains(&k.as_str()) {
            return Err(format!("profile has an unknown key `{k}` (known: {})", PROFILE_KEYS.join(", ")));
        }
    }
    if obj.get("name").and_then(|n| n.as_str()).map_or(true, |n| n.trim().is_empty()) {
        return Err("profile needs a `name`".into());
    }
    serde_json::from_value(v.clone()).map_err(|e| format!("profile is malformed: {e}"))
}

/// A secret setting is marked `"x-secret": true` in the plugin's `settings_schema`.
fn is_secret(schema: &Value) -> bool {
    schema.get("x-secret") == Some(&Value::Bool(true))
}

fn marker() -> Value {
    json!({"$secret": true})
}

fn is_marker(v: &Value) -> bool {
    v.get("$secret") == Some(&Value::Bool(true))
}

/// Replace every secret value with the marker. Reads the schema; the data never leaves.
pub fn redact(value: &Value, schema: &Value) -> Value {
    if is_secret(schema) {
        return marker();
    }
    match value {
        Value::Object(o) => {
            let props = schema.get("properties");
            Value::Object(o.iter().map(|(k, v)| (k.clone(), redact(v, props.and_then(|p| p.get(k)).unwrap_or(&Value::Null)))).collect())
        }
        Value::Array(a) => {
            let items = schema.get("items").unwrap_or(&Value::Null);
            Value::Array(a.iter().map(|v| redact(v, items)).collect())
        }
        v => v.clone(),
    }
}

/// Put the stored value back wherever a draft still holds the marker. A secret that the draft
/// replaces is taken as typed. Arrays are matched by position.
pub fn restore(draft: &Value, stored: &Value, schema: &Value) -> Value {
    if is_marker(draft) {
        return stored.clone();
    }
    match draft {
        Value::Object(o) => {
            let props = schema.get("properties");
            let empty = Map::new();
            let st = stored.as_object().unwrap_or(&empty);
            Value::Object(o.iter().map(|(k, v)| (k.clone(), restore(v, st.get(k).unwrap_or(&Value::Null), props.and_then(|p| p.get(k)).unwrap_or(&Value::Null)))).collect())
        }
        Value::Array(a) => {
            let items = schema.get("items").unwrap_or(&Value::Null);
            let st = stored.as_array().cloned().unwrap_or_default();
            Value::Array(a.iter().enumerate().map(|(i, v)| restore(v, st.get(i).unwrap_or(&Value::Null), items)).collect())
        }
        v => v.clone(),
    }
}

/// Redact all settings of a Profile with their plugins' schemas.
pub fn redact_profile(dist: &Distribution) -> Value {
    let mut p = serde_json::to_value(&dist.profile).unwrap_or(Value::Null);
    if let Some(settings) = p.get_mut("settings").and_then(|s| s.as_object_mut()) {
        for (id, v) in settings.iter_mut() {
            if let Some(pl) = dist.catalog.0.iter().find(|pl| pl.manifest().id == *id) {
                *v = redact(v, &pl.manifest().settings_schema);
            }
        }
    }
    p
}

/// Restore the markers in a draft Profile from the stored one.
pub fn restore_profile(draft: &mut Profile, stored: &Profile, dist: &Distribution) {
    for (id, v) in draft.settings.iter_mut() {
        let schema = dist.catalog.0.iter().find(|pl| pl.manifest().id == *id).map(|pl| pl.manifest().settings_schema).unwrap_or(Value::Null);
        *v = restore(v, stored.settings.get(id).unwrap_or(&Value::Null), &schema);
    }
}

/// The Catalog and the current choices as JSON for a setup Face. Reads manifests only; secrets are
/// redacted.
pub fn catalog_info(dist: &Distribution) -> Value {
    let mut plugins: Vec<Value> = dist
        .catalog
        .0
        .iter()
        .map(|pl| {
            let m = pl.manifest();
            json!({
                "id": m.id, "version": m.version, "name": m.name, "description": m.description,
                "kind": m.kind(), "quality": m.quality, "runtime": m.runtime,
                "fills": m.fills,
                "defines": m.defines.extension_points.iter().map(|(n, d)| json!({"name": n, "policy": d.policy})).collect::<Vec<_>>(),
                "provides": m.provides.iter().map(|p| &p.extension_point).collect::<Vec<_>>(),
                "requires": {"plugins": m.requires.plugins, "ports": m.requires.ports, "extension_points": m.requires.extension_points, "capabilities": m.requires.capabilities},
                "operations": m.operations.keys().collect::<Vec<_>>(),
                "settings_schema": m.settings_schema,
            })
        })
        .collect();
    plugins.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    json!({"distribution": dist.name, "profile": redact_profile(dist), "core_ports": PORTS, "plugins": plugins})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_profiles() {
        assert!(profile_from_json(&json!({"name":"a","enabeld":[]})).unwrap_err().contains("enabeld"));
        assert!(profile_from_json(&json!({"enabled":[]})).is_err());
        assert!(profile_from_json(&json!({"name":"a","enabled":"x"})).is_err());
        assert_eq!(profile_from_json(&json!({"name":"a","enabled":["x"]})).unwrap().enabled, vec!["x"]);
    }

    #[test]
    fn secrets_are_hidden_and_restored() {
        let schema = json!({"type":"object","properties":{"accounts":{"x-secret":true},"hours":{"type":"integer"}}});
        let stored = json!({"accounts":[{"name":"a","password_hash":"h"}],"hours":3});
        let shown = redact(&stored, &schema);
        assert_eq!(shown, json!({"accounts": {"$secret": true}, "hours": 3}));
        assert!(!shown.to_string().contains("password_hash"));
        // Untouched: the stored value comes back. Replaced: the typed value wins.
        assert_eq!(restore(&shown, &stored, &schema), stored);
        let typed = json!({"accounts":[{"name":"b","password_hash":"x"}],"hours":4});
        assert_eq!(restore(&typed, &stored, &schema), typed);
    }
}
