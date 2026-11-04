//! The Madar distribution: a pinned list of plugins that makes a task manager.
//! Everything product-specific lives here; the kernel and the adapters know nothing about tasks.

pub mod extras;
pub mod tasks;

use nuah_adapters::*;
use nuah_kernel::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

/// Every plugin this distribution can ship. A profile says which are on.
pub fn catalog() -> Vec<Arc<dyn Plugin>> {
    let mut c: Vec<Arc<dyn Plugin>> = vec![
        Arc::new(StdPlugin),
        Arc::new(FixedPlugin),
        Arc::new(MemoryDbPlugin),
        Arc::new(SqliteDbPlugin),
        Arc::new(AuthLocalPlugin),
        Arc::new(AuthTokenPlugin),
        Arc::new(PolicyAllowPlugin),
        Arc::new(PolicyRolesPlugin),
        Arc::new(tasks::TasksPlugin),
        Arc::new(extras::AuditPlugin),
        Arc::new(extras::QuotaPlugin),
        Arc::new(extras::PrefsPlugin),
        Arc::new(extras::ExportPlugin),
    ];
    for t in extras::builtin_themes() {
        c.push(Arc::new(t));
    }
    c
}

const COMMON: [&str; 6] = ["tasks", "audit", "prefs", "export", "theme-paper", "theme-ink"];

/// Personal, offline, single user: the profile a coupled app uses.
pub fn embedded(db_path: &str, display_name: &str) -> Distribution {
    let mut enabled: Vec<String> = ["std", "adapter-sqlite", "auth-local", "policy-allow-all"].iter().map(|s| s.to_string()).collect();
    enabled.extend(COMMON.iter().map(|s| s.to_string()));
    Distribution {
        name: "embedded".into(),
        catalog: catalog(),
        enabled,
        bindings: HashMap::new(),
        settings: HashMap::from([
            ("adapter-sqlite".to_string(), json!({"path": db_path})),
            ("auth-local".to_string(), json!({"display": display_name})),
        ]),
    }
}

/// Everything in memory with fixed clock and ids, for tests and replay.
pub fn memory_for_tests() -> Distribution {
    let mut enabled: Vec<String> = ["std-fixed", "adapter-memory", "auth-local", "policy-allow-all"].iter().map(|s| s.to_string()).collect();
    enabled.extend(COMMON.iter().map(|s| s.to_string()));
    Distribution {
        name: "test".into(),
        catalog: catalog(),
        enabled,
        bindings: HashMap::new(),
        settings: HashMap::new(),
    }
}

/// Build a distribution from a profile file:
/// {"name": "server", "enabled": [...], "bindings": {...}, "settings": {...}}
pub fn from_profile_json(text: &str) -> std::result::Result<Distribution, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("profile is not valid JSON: {e}"))?;
    let name = v["name"].as_str().ok_or("profile needs a `name`")?.to_string();
    let list = |k: &str| -> Vec<String> {
        v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
    };
    let map = |k: &str| -> HashMap<String, Value> {
        v[k].as_object().map(|o| o.iter().map(|(a, b)| (a.clone(), b.clone())).collect()).unwrap_or_default()
    };
    Ok(Distribution {
        name,
        catalog: catalog(),
        enabled: list("enabled"),
        bindings: map("bindings").into_iter().filter_map(|(k, x)| x.as_str().map(|s| (k, s.to_string()))).collect(),
        settings: map("settings"),
    })
}

/// Start a core or explain every problem found.
pub fn start(dist: Distribution) -> std::result::Result<Core, String> {
    Core::start(dist).map_err(|problems| {
        let mut m = String::from("cannot start:\n");
        for p in problems {
            m.push_str(&format!("  - {p}\n"));
        }
        m
    })
}
