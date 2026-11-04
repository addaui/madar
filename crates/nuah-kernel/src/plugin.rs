//! The plugin API: what a plugin sees while activating and while running.

use crate::error::{LinkError, Result};
use crate::manifest::Manifest;
use crate::ports::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    Command,
    Query,
}

/// One entry of the contract.
#[derive(Debug, Clone, Serialize)]
pub struct OpSpec {
    pub name: String,
    pub kind: OpKind,
    pub permission: String,
    pub doc: String,
    /// JSON-schema subset, checked by the kernel before the handler runs.
    pub input: Value,
    /// Collection the operation mainly touches. Wrapping plugins (audit) use it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
}

impl OpSpec {
    pub fn command(name: &str, permission: &str, doc: &str, input: Value) -> Self {
        OpSpec { name: name.into(), kind: OpKind::Command, permission: permission.into(), doc: doc.into(), input, entity: None }
    }
    pub fn query(name: &str, permission: &str, doc: &str, input: Value) -> Self {
        OpSpec { name: name.into(), kind: OpKind::Query, permission: permission.into(), doc: doc.into(), input, entity: None }
    }
    pub fn entity(mut self, collection: &str) -> Self {
        self.entity = Some(collection.into());
        self
    }
}

/// Who is calling and where. Built by the kernel from the verified identity; a plugin cannot forge it.
#[derive(Clone)]
pub struct Ctx {
    pub subject: String,
    pub display: String,
    pub roles: Vec<String>,
    pub request_id: String,
    /// "web", "cli", "agent", ... as announced by the face. Informational, never trusted for access.
    pub face: Option<String>,
    pub now_ms: i64,
    /// Plugin that owns the handler or hook currently running (for attribution).
    pub plugin: String,
    scratch: Arc<Mutex<HashMap<String, Value>>>,
}

impl Ctx {
    pub(crate) fn new(identity: &Identity, request_id: String, face: Option<String>, now_ms: i64) -> Self {
        Ctx {
            subject: identity.subject.clone(),
            display: identity.display.clone(),
            roles: identity.roles.clone(),
            request_id,
            face,
            now_ms,
            plugin: String::new(),
            scratch: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    pub(crate) fn for_plugin(&self, plugin: &str) -> Ctx {
        let mut c = self.clone();
        c.plugin = plugin.to_string();
        c
    }
    /// Per-call scratch space shared by before hooks, the handler and after hooks.
    pub fn scratch_set(&self, key: &str, value: Value) {
        self.scratch.lock().unwrap().insert(key.to_string(), value);
    }
    pub fn scratch_get(&self, key: &str) -> Option<Value> {
        self.scratch.lock().unwrap().get(key).cloned()
    }
}

/// The storage a plugin gets: the real db, minus the collections that belong to the kernel
/// (names starting with `_`, such as the event log and idempotency records).
pub(crate) struct GuardedDb {
    inner: Arc<dyn Db>,
    plugin: String,
}

impl GuardedDb {
    fn check(&self, collection: &str) -> Result<()> {
        if collection.starts_with('_') {
            Err(LinkError::capability_denied(&self.plugin, &format!("collection `{collection}`")))
        } else {
            Ok(())
        }
    }
}

impl Db for GuardedDb {
    fn id(&self) -> &str {
        self.inner.id()
    }
    fn capabilities(&self) -> Vec<String> {
        self.inner.capabilities()
    }
    fn get(&self, c: &str, id: &str) -> Result<Option<Value>> {
        self.check(c)?;
        self.inner.get(c, id)
    }
    fn put_new(&self, c: &str, id: &str, doc: &Value) -> Result<bool> {
        self.check(c)?;
        self.inner.put_new(c, id, doc)
    }
    fn transaction(&self, f: &mut dyn FnMut() -> Result<()>) -> Result<()> {
        self.inner.transaction(f)
    }
    fn put(&self, c: &str, id: &str, doc: &Value) -> Result<()> {
        self.check(c)?;
        self.inner.put(c, id, doc)
    }
    fn delete(&self, c: &str, id: &str) -> Result<bool> {
        self.check(c)?;
        self.inner.delete(c, id)
    }
    fn query(&self, q: &Query) -> Result<Vec<Value>> {
        self.check(&q.collection)?;
        self.inner.query(q)
    }
    fn batch(&self, ops: &[WriteOp]) -> Result<()> {
        for op in ops {
            match op {
                WriteOp::Put { collection, .. } | WriteOp::Delete { collection, .. } => self.check(collection)?,
            }
        }
        self.inner.batch(ops)
    }
}

pub(crate) struct PendingEvent {
    pub kind: String,
    pub plugin: String,
    pub audience: String,
    pub data: Value,
}

/// The capability broker's view for one plugin: only what its manifest asked for.
pub struct Services {
    plugin: String,
    allowed: Arc<HashSet<String>>,
    ports: Arc<Ports>,
    db: Arc<dyn Db>,
    settings: Value,
    pending: Mutex<Vec<PendingEvent>>,
}

impl Services {
    pub(crate) fn new(plugin: &str, allowed: Arc<HashSet<String>>, ports: Arc<Ports>, settings: Value) -> Self {
        let db: Arc<dyn Db> = Arc::new(GuardedDb { inner: ports.db.clone(), plugin: plugin.to_string() });
        Services { plugin: plugin.to_string(), allowed, ports, db, settings, pending: Mutex::new(vec![]) }
    }
    fn need(&self, cap: &str) -> Result<()> {
        if self.allowed.contains(cap) {
            Ok(())
        } else {
            Err(LinkError::capability_denied(&self.plugin, cap))
        }
    }
    pub fn db(&self) -> Result<&Arc<dyn Db>> {
        self.need("db")?;
        Ok(&self.db)
    }
    pub fn clock(&self) -> Result<&Arc<dyn Clock>> {
        self.need("clock")?;
        Ok(&self.ports.clock)
    }
    pub fn ids(&self) -> Result<&Arc<dyn Ids>> {
        self.need("ids")?;
        Ok(&self.ports.ids)
    }
    pub fn settings(&self) -> &Value {
        &self.settings
    }
    /// Queue an event. It is published only if the whole call succeeds.
    pub fn emit(&self, kind: &str, audience: &str, data: Value) -> Result<()> {
        self.need("events")?;
        self.pending.lock().unwrap().push(PendingEvent {
            kind: kind.to_string(),
            plugin: self.plugin.clone(),
            audience: audience.to_string(),
            data,
        });
        Ok(())
    }
    pub(crate) fn take_pending(&self) -> Vec<PendingEvent> {
        std::mem::take(&mut *self.pending.lock().unwrap())
    }
}

// ---------- registrations ----------

pub type OpHandler = Arc<dyn Fn(&Ctx, Value, &Services) -> Result<Value> + Send + Sync>;
pub type BeforeFn = Arc<dyn Fn(&Ctx, &OpSpec, &mut Value, &Services) -> Result<()> + Send + Sync>;
pub type AfterFn = Arc<dyn Fn(&Ctx, &OpSpec, &Value, &Value, &Services) -> Result<()> + Send + Sync>;
pub type ListenerFn = Arc<dyn Fn(&crate::events::Event, &Services) -> Result<()> + Send + Sync>;
pub type RouteFn = Arc<dyn Fn(&Ctx, RouteRequest, &Services) -> Result<RouteResponse> + Send + Sync>;

pub struct RouteRequest {
    pub query: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct RouteResponse {
    pub status: u16,
    pub content_type: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct RouteSpec {
    pub method: String,
    pub path: String,
    pub permission: String,
}

#[derive(Clone)]
pub(crate) struct OpEntry {
    pub spec: OpSpec,
    pub handler: OpHandler,
    pub owner: String,
}
#[derive(Clone)]
pub(crate) enum HookFn {
    Before(BeforeFn),
    After(AfterFn),
}
#[derive(Clone)]
pub(crate) struct HookEntry {
    pub owner: String,
    pub name: String,
    pub pattern: String,
    pub priority: i32,
    pub f: HookFn,
}
#[derive(Clone)]
pub(crate) struct ListenerEntry {
    pub owner: String,
    pub pattern: String,
    pub f: ListenerFn,
}
#[derive(Clone)]
pub(crate) struct RouteEntry {
    pub owner: String,
    pub spec: RouteSpec,
    pub handler: RouteFn,
}

#[derive(Default)]
pub(crate) struct PortSlots {
    pub db: Option<Arc<dyn Db>>,
    pub auth: Option<Arc<dyn Auth>>,
    pub policy: Option<Arc<dyn Policy>>,
    pub clock: Option<Arc<dyn Clock>>,
    pub ids: Option<Arc<dyn Ids>>,
}

/// Passed to `Plugin::activate`. Everything registered here is tagged with the plugin id,
/// so disabling the plugin removes all of it and nothing else.
pub struct Activation {
    pub(crate) plugin: String,
    pub(crate) settings: Value,
    pub(crate) ops: Vec<OpEntry>,
    pub(crate) hooks: Vec<HookEntry>,
    pub(crate) listeners: Vec<ListenerEntry>,
    pub(crate) routes: Vec<RouteEntry>,
    pub(crate) ports: PortSlots,
}

impl Activation {
    pub(crate) fn new(plugin: &str, settings: Value) -> Self {
        Activation {
            plugin: plugin.to_string(),
            settings,
            ops: vec![],
            hooks: vec![],
            listeners: vec![],
            routes: vec![],
            ports: PortSlots::default(),
        }
    }
    pub fn settings(&self) -> &Value {
        &self.settings
    }
    pub fn op(&mut self, spec: OpSpec, handler: impl Fn(&Ctx, Value, &Services) -> Result<Value> + Send + Sync + 'static) {
        self.ops.push(OpEntry { spec, handler: Arc::new(handler), owner: self.plugin.clone() });
    }
    /// Run before matching operations. May change the input or veto by returning an error.
    /// `pattern` is "*", "prefix.*" or an exact name. Lower priority runs first.
    pub fn before(
        &mut self,
        name: &str,
        pattern: &str,
        priority: i32,
        f: impl Fn(&Ctx, &OpSpec, &mut Value, &Services) -> Result<()> + Send + Sync + 'static,
    ) {
        self.hooks.push(HookEntry {
            owner: self.plugin.clone(),
            name: name.into(),
            pattern: pattern.into(),
            priority,
            f: HookFn::Before(Arc::new(f)),
        });
    }
    /// Run after the handler, inside the same transaction. An error here fails the whole call and
    /// rolls everything back, so a hook such as audit can promise that no change goes unrecorded.
    pub fn after(
        &mut self,
        name: &str,
        pattern: &str,
        priority: i32,
        f: impl Fn(&Ctx, &OpSpec, &Value, &Value, &Services) -> Result<()> + Send + Sync + 'static,
    ) {
        self.hooks.push(HookEntry {
            owner: self.plugin.clone(),
            name: name.into(),
            pattern: pattern.into(),
            priority,
            f: HookFn::After(Arc::new(f)),
        });
    }
    pub fn on_event(&mut self, pattern: &str, f: impl Fn(&crate::events::Event, &Services) -> Result<()> + Send + Sync + 'static) {
        self.listeners.push(ListenerEntry { owner: self.plugin.clone(), pattern: pattern.into(), f: Arc::new(f) });
    }
    pub fn route(&mut self, spec: RouteSpec, f: impl Fn(&Ctx, RouteRequest, &Services) -> Result<RouteResponse> + Send + Sync + 'static) {
        self.routes.push(RouteEntry { owner: self.plugin.clone(), spec, handler: Arc::new(f) });
    }
    pub fn provide_db(&mut self, a: Arc<dyn Db>) {
        self.ports.db = Some(a);
    }
    pub fn provide_auth(&mut self, a: Arc<dyn Auth>) {
        self.ports.auth = Some(a);
    }
    pub fn provide_policy(&mut self, a: Arc<dyn Policy>) {
        self.ports.policy = Some(a);
    }
    pub fn provide_clock(&mut self, a: Arc<dyn Clock>) {
        self.ports.clock = Some(a);
    }
    pub fn provide_ids(&mut self, a: Arc<dyn Ids>) {
        self.ports.ids = Some(a);
    }
}

pub trait Plugin: Send + Sync {
    fn manifest(&self) -> Manifest;
    fn activate(&self, act: &mut Activation) -> Result<()>;
}

/// Pattern used by hooks and listeners: "*", "prefix.*", or an exact name.
pub fn pattern_matches(pattern: &str, name: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    match pattern.strip_suffix(".*") {
        Some(prefix) => name.starts_with(prefix) && name[prefix.len()..].starts_with('.'),
        None => pattern == name,
    }
}
