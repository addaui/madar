//! The manifest: what a plugin says about itself without running any code.
//! The resolver, the setup wizard, `describe` and the admin UI all read this and never load the plugin.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    /// "adapter", "domain", "wrap", "theme", ...
    #[serde(default)]
    pub kind: String,
    /// "native" (T0) here. "data" means no code at all (themes). wasm/js/remote are not built yet.
    #[serde(default = "native")]
    pub runtime: String,
    #[serde(default)]
    pub implements: Vec<Implements>,
    #[serde(default)]
    pub requires: Requires,
    #[serde(default)]
    pub contributes: Contributes,
    /// Empty means every profile.
    #[serde(default)]
    pub profiles: Vec<String>,
    #[serde(default)]
    pub quality: String,
}

fn native() -> String {
    "native".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Implements {
    pub port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Requires {
    /// Ports the plugin may call through `Services` ("db", "clock", "ids"). Anything else is denied.
    #[serde(default)]
    pub ports: Vec<String>,
    /// Other capabilities, for now only "events".
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Contributes {
    /// Every operation the plugin registers. The kernel refuses a plugin that registers more or fewer.
    #[serde(default)]
    pub ops: Vec<String>,
    /// HTTP-style routes the plugin adds, as "METHOD /path".
    #[serde(default)]
    pub routes: Vec<String>,
    /// UI slot items, rendered by faces from data. Shape: {slot, id, label, action, faces?}.
    #[serde(default)]
    pub slots: Vec<Value>,
    /// Face-side assets such as themes. Faces pick the ones they understand.
    #[serde(default)]
    pub assets: Vec<Value>,
}

impl Manifest {
    pub fn parse(json: &str) -> Manifest {
        serde_json::from_str(json).unwrap_or_else(|e| panic!("invalid plugin manifest: {e}\n{json}"))
    }

    pub fn allowed_capabilities(&self) -> std::collections::HashSet<String> {
        self.requires.ports.iter().chain(self.requires.capabilities.iter()).cloned().collect()
    }
}
