//! The manifest: what a plugin says about itself without running any code.
//! The resolver, the setup wizard, `describe` and the admin UI all read this and never load the plugin.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    /// One line for people choosing plugins (the setup wizard shows it).
    #[serde(default)]
    pub description: String,
    /// "adapter", "domain", "wrap", "theme", ...
    #[serde(default)]
    pub kind: String,
    /// "native" (T0) here. "data" means no code at all (themes). wasm/js/remote are not built yet.
    #[serde(default = "native")]
    pub runtime: String,
    #[serde(default)]
    pub implements: Vec<Implements>,
    /// Extension points this plugin creates for other plugins to fill.
    #[serde(default)]
    pub defines: Defines,
    /// Plugin-defined ports this plugin fills.
    #[serde(default)]
    pub provides: Vec<Provides>,
    #[serde(default)]
    pub requires: Requires,
    #[serde(default)]
    pub contributes: Contributes,
    /// Which collections the plugin owns (may write) and which it may read without owning.
    /// "*" in `reads` means everything (visible in describe, so it is easy to audit).
    #[serde(default)]
    pub data: Data,
    /// Empty means every profile.
    #[serde(default)]
    pub profiles: Vec<String>,
    #[serde(default)]
    pub quality: String,
    /// JSON-schema subset for this plugin's entry under `settings` in the distribution. Checked at
    /// start, so a bad setting is reported by the resolver and not by a crash later.
    #[serde(default)]
    pub settings_schema: Value,
    /// Hook order between plugins. Only decides between hooks of equal priority.
    #[serde(default)]
    pub order: Order,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Order {
    /// Plugin ids whose hooks run before this plugin's.
    #[serde(default)]
    pub after: Vec<String>,
    /// Plugin ids whose hooks run after this plugin's.
    #[serde(default)]
    pub before: Vec<String>,
}

fn native() -> String {
    "native".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Implements {
    pub port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Defines {
    #[serde(default)]
    pub ports: Vec<PortDef>,
}

/// A port a plugin invents. Its name must start with the defining plugin's id and a dot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortDef {
    pub name: String,
    #[serde(default)]
    pub doc: String,
    /// "single": exactly one provider is bound. "first": providers are tried in priority order and
    /// the first answer that is not null wins. "many": every provider is called.
    #[serde(default = "single")]
    pub policy: String,
    pub methods: std::collections::BTreeMap<String, PortMethod>,
}

fn single() -> String {
    "single".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortMethod {
    #[serde(default)]
    pub doc: String,
    /// JSON-schema subset, checked before any provider runs.
    #[serde(default)]
    pub input: Value,
    /// Read-only methods may be called from queries.
    #[serde(default)]
    pub readonly: bool,
    /// Optional shape of what a provider returns, checked on every answer. Providers that break it
    /// fail like any other provider error.
    #[serde(default)]
    pub output: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provides {
    pub port: String,
    /// Lower runs first for `first` and `many`.
    #[serde(default)]
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Data {
    #[serde(default)]
    pub owns: Vec<String>,
    #[serde(default)]
    pub reads: Vec<String>,
    /// Indexes on fields of collections the plugin owns. Created at start if the db supports them.
    #[serde(default)]
    pub indexes: Vec<IndexDef>,
    /// Version of the plugin's stored data. When it is higher than what the database remembers,
    /// `Plugin::migrate` runs once, in a transaction, before anything is served. 0 means unversioned.
    #[serde(default)]
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDef {
    pub collection: String,
    pub field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Requires {
    /// Other plugins that must be active: "tasks" or "tasks@0.1" (version prefix).
    #[serde(default)]
    pub plugins: Vec<String>,
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
    /// Event kinds the plugin may emit. Emitting anything else is refused, so faces and agents can
    /// learn the vocabulary of Pulse from `describe` instead of guessing.
    #[serde(default)]
    pub events: Vec<String>,
    /// Optional shape of the `data` of an event kind, checked when the event is emitted.
    #[serde(default)]
    pub event_schemas: std::collections::BTreeMap<String, Value>,
    /// Face-side assets such as themes. Faces pick the ones they understand.
    #[serde(default)]
    pub assets: Vec<Value>,
}

impl Manifest {
    pub fn parse(json: &str) -> Manifest {
        serde_json::from_str(json).unwrap_or_else(|e| panic!("invalid plugin manifest: {e}\n{json}"))
    }

    pub fn allowed_capabilities(&self) -> std::collections::HashSet<String> {
        let mut set: std::collections::HashSet<String> =
            self.requires.ports.iter().chain(self.requires.capabilities.iter()).cloned().collect();
        if !self.requires.plugins.is_empty() {
            set.insert("call".to_string()); // may call the plugins it requires
        }
        set
    }
}
