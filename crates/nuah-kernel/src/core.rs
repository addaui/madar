//! The kernel: resolves a distribution, activates plugins, and runs every call through one pipeline.
//!
//! call(): authenticate -> find op -> policy -> contract check -> idempotency -> before hooks
//!         -> handler -> after hooks -> publish events -> remember result

use crate::error::{LinkError, Result};
use crate::events::{Event, EventLog};
use crate::manifest::Manifest;
use crate::plugin::*;
use crate::ports::*;
use crate::schema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::broadcast;

pub const CONTRACT_VERSION: &str = "0.1";

/// What an operator chooses: which plugins are on, which adapter fills each port, and settings.
pub struct Distribution {
    pub name: String,
    pub catalog: Vec<Arc<dyn Plugin>>,
    pub enabled: Vec<String>,
    pub bindings: HashMap<String, String>,
    pub settings: HashMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CallRequest {
    pub credential: Option<String>,
    pub op: String,
    pub input: Value,
    pub idempotency_key: Option<String>,
    pub face: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CallResponse {
    pub data: Value,
    /// True when the answer was remembered from an earlier call with the same idempotency key.
    pub replayed: bool,
}

#[derive(Default)]
struct State {
    ops: HashMap<String, OpEntry>,
    hooks: Vec<HookEntry>,
    listeners: Vec<ListenerEntry>,
    routes: Vec<RouteEntry>,
    active: Vec<String>,
    inactive: Vec<(String, String)>,
}

struct Inner {
    name: String,
    ports: Arc<Ports>,
    events: EventLog,
    manifests: HashMap<String, Manifest>,
    settings: HashMap<String, Value>,
    /// port name -> adapter plugin id
    bound: HashMap<String, String>,
    state: RwLock<State>,
    /// Live requests by id. The kernel, not the plugin, is the source of truth for who a request
    /// belongs to when a plugin calls another plugin.
    requests: Mutex<HashMap<String, RequestInfo>>,
}

struct RequestInfo {
    ident: Identity,
    face: Option<String>,
    kind: OpKind,
    depth: u8,
}

struct RequestGuard<'a> {
    map: &'a Mutex<HashMap<String, RequestInfo>>,
    id: String,
}
impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.map.lock().unwrap().remove(&self.id);
    }
}

/// Run plugin code so that a panic becomes an ordinary error: the transaction rolls back and the
/// caller gets an `internal` error instead of a crashed thread.
fn guarded<T>(what: &str, f: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            let msg = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default();
            eprintln!("[nuah] {what} panicked: {msg}");
            Err(LinkError::internal(format!("{what} panicked")))
        }
    }
}

#[derive(Clone)]
pub struct Core {
    inner: Arc<Inner>,
}

struct PipelineOut {
    data: Value,
    /// Events already written to the log (top-level calls).
    events: Vec<Event>,
    /// Events handed back unwritten (nested calls); the outer call writes them.
    pending: Vec<PendingEvent>,
    replayed: bool,
}

impl Core {
    /// Resolve and start. Returns every problem found, not just the first, so an operator
    /// (or the setup wizard) can fix them in one go.
    pub fn start(dist: Distribution) -> std::result::Result<Core, Vec<String>> {
        let mut problems: Vec<String> = vec![];
        {
            let mut seen = HashSet::new();
            for p in &dist.catalog {
                let id = p.manifest().id;
                if !seen.insert(id.clone()) {
                    problems.push(format!("two plugins in the catalog share the id `{id}`"));
                }
            }
        }
        let catalog: HashMap<String, Arc<dyn Plugin>> =
            dist.catalog.iter().map(|p| (p.manifest().id, p.clone())).collect();
        let manifests: HashMap<String, Manifest> = catalog.iter().map(|(k, p)| (k.clone(), p.manifest())).collect();

        // 1. which plugins are on for this profile
        let mut active: Vec<String> = vec![];
        let mut inactive: Vec<(String, String)> = vec![];
        let mut seen = HashSet::new();
        for id in &dist.enabled {
            if !seen.insert(id.clone()) {
                problems.push(format!("plugin `{id}` is listed twice"));
                continue;
            }
            match manifests.get(id) {
                None => problems.push(format!("plugin `{id}` is enabled but is not in the catalog")),
                Some(m) if !m.profiles.is_empty() && !m.profiles.contains(&dist.name) => {
                    inactive.push((id.clone(), format!("not available in profile `{}`", dist.name)))
                }
                Some(m) => {
                    if m.runtime != "native" && m.runtime != "data" {
                        problems.push(format!("plugin `{id}` needs runtime `{}`, which this kernel does not have", m.runtime));
                    } else {
                        active.push(id.clone())
                    }
                }
            }
        }

        // 2. every port needs exactly one adapter
        let mut bound: HashMap<String, String> = HashMap::new();
        for port in PORT_NAMES {
            let impls: Vec<&String> = active
                .iter()
                .filter(|id| manifests[*id].implements.iter().any(|i| i.port == port))
                .collect();
            match dist.bindings.get(port) {
                Some(b) if impls.iter().any(|i| *i == b) => {
                    bound.insert(port.to_string(), b.clone());
                }
                Some(b) => problems.push(format!(
                    "port `{port}` is bound to `{b}`, which is not an enabled plugin implementing it (candidates: {})",
                    join(&impls)
                )),
                None => match impls.len() {
                    1 => {
                        bound.insert(port.to_string(), impls[0].clone());
                    }
                    0 => problems.push(format!("port `{port}` has no adapter: enable a plugin that implements it")),
                    _ => problems.push(format!("port `{port}` is ambiguous ({}): bind one in the distribution", join(&impls))),
                },
            }
        }
        for id in &active {
            for i in &manifests[id].implements {
                if !PORT_NAMES.contains(&i.port.as_str()) {
                    problems.push(format!("plugin `{id}` implements unknown port `{}`", i.port));
                }
            }
            for cap in manifests[id].requires.capabilities.iter() {
                if cap != "events" {
                    problems.push(format!("plugin `{id}` requires unknown capability `{cap}`"));
                }
            }
            for need in manifests[id].requires.ports.iter() {
                if !PORT_NAMES.contains(&need.as_str()) {
                    problems.push(format!("plugin `{id}` requires unknown port `{need}`"));
                }
            }
        }
        // an adapter plugin must be chosen for all of its ports or none
        let mut still_active = vec![];
        for id in &active {
            let impls = &manifests[id].implements;
            if impls.is_empty() {
                still_active.push(id.clone());
                continue;
            }
            let chosen: Vec<bool> = impls.iter().map(|i| bound.get(&i.port) == Some(id)).collect();
            if chosen.iter().all(|c| *c) {
                still_active.push(id.clone());
            } else if chosen.iter().any(|c| *c) {
                problems.push(format!("adapter `{id}` implements several ports and is chosen for only some of them"));
            } else {
                let ports: Vec<&str> = impls.iter().map(|i| i.port.as_str()).collect();
                inactive.push((id.clone(), format!("not bound for port {}", ports.join(", "))));
            }
        }
        let active = still_active;
        for id in &active {
            for dep in manifests[id].requires.plugins.iter() {
                let (dep_id, want) = match dep.split_once('@') { Some((a, b)) => (a, Some(b)), None => (dep.as_str(), None) };
                match manifests.get(dep_id).filter(|_| active.iter().any(|a| a == dep_id)) {
                    None => problems.push(format!("plugin `{id}` requires plugin `{dep_id}`, which is not enabled")),
                    Some(m) => {
                        if want.is_some_and(|w| !(m.version == w || m.version.starts_with(&format!("{w}.")))) {
                            problems.push(format!("plugin `{id}` requires `{dep}`, but `{dep_id}` is version {}", m.version));
                        }
                    }
                }
            }
        }
        {
            let mut owners: HashMap<&str, &str> = HashMap::new();
            for id in &active {
                for c in &manifests[id].data.owns {
                    if let Some(first) = owners.insert(c.as_str(), id.as_str()) {
                        problems.push(format!("collection `{c}` is owned by both `{first}` and `{id}`"));
                    }
                }
            }
        }
        if !problems.is_empty() {
            return Err(problems);
        }

        // 3. activate adapters first, then everything else
        let (adapters, others): (Vec<&String>, Vec<&String>) =
            active.iter().partition(|id| !manifests[*id].implements.is_empty());
        let mut slots = PortSlots::default();
        let mut collected: Vec<(String, Activation)> = vec![];
        for id in adapters {
            let mut act = Activation::new(id, dist.settings.get(id).cloned().unwrap_or(Value::Null));
            if let Err(e) = catalog[id].activate(&mut act) {
                problems.push(format!("adapter `{id}` failed to start: {e}"));
                continue;
            }
            let p = std::mem::take(&mut act.ports);
            let bound_here = |port: &str| bound.get(port).map(|b| b == id).unwrap_or(false);
            macro_rules! take {
                ($port:literal, $field:ident) => {
                    if p.$field.is_some() {
                        if bound_here($port) {
                            slots.$field = p.$field;
                        } else {
                            problems.push(format!("adapter `{id}` provided port `{}` but is not bound to it", $port));
                        }
                    }
                };
            }
            take!("db", db);
            take!("auth", auth);
            take!("policy", policy);
            take!("clock", clock);
            take!("ids", ids);
            collected.push((id.clone(), act));
        }
        for (name, missing) in [
            ("db", slots.db.is_none()),
            ("auth", slots.auth.is_none()),
            ("policy", slots.policy.is_none()),
            ("clock", slots.clock.is_none()),
            ("ids", slots.ids.is_none()),
        ] {
            if missing {
                problems.push(format!("the adapter bound to port `{name}` did not provide it"));
            }
        }
        if !problems.is_empty() {
            return Err(problems);
        }
        let ports = Arc::new(Ports {
            db: slots.db.unwrap(),
            auth: slots.auth.unwrap(),
            policy: slots.policy.unwrap(),
            clock: slots.clock.unwrap(),
            ids: slots.ids.unwrap(),
        });
        let events = match EventLog::open(ports.db.clone()) {
            Ok(e) => e,
            Err(e) => return Err(vec![format!("cannot open the event log: {e}")]),
        };
        for id in others {
            let mut act = Activation::new(id, dist.settings.get(id).cloned().unwrap_or(Value::Null));
            if let Err(e) = catalog[id].activate(&mut act) {
                problems.push(format!("plugin `{id}` failed to start: {e}"));
                continue;
            }
            collected.push((id.clone(), act));
        }

        // 4. the plugin must do what its manifest says
        let mut state = State { active: active.clone(), inactive, ..Default::default() };
        for (id, act) in collected {
            let m = &manifests[&id];
            let declared: BTreeSet<&String> = m.contributes.ops.iter().collect();
            let registered: BTreeSet<&String> = act.ops.iter().map(|o| &o.spec.name).collect();
            for extra in registered.difference(&declared) {
                problems.push(format!("plugin `{id}` registered op `{extra}` but its manifest does not declare it"));
            }
            for missing in declared.difference(&registered) {
                problems.push(format!("plugin `{id}` declares op `{missing}` but did not register it"));
            }
            let declared_routes: BTreeSet<String> = m.contributes.routes.iter().map(|r| r.to_uppercase()).collect();
            let registered_routes: BTreeSet<String> =
                act.routes.iter().map(|r| format!("{} {}", r.spec.method, r.spec.path).to_uppercase()).collect();
            for extra in registered_routes.difference(&declared_routes) {
                problems.push(format!("plugin `{id}` registered route `{extra}` but its manifest does not declare it"));
            }
            for missing in declared_routes.difference(&registered_routes) {
                problems.push(format!("plugin `{id}` declares route `{missing}` but did not register it"));
            }
            for r in &act.routes {
                let key = format!("{} {}", r.spec.method, r.spec.path).to_uppercase();
                if state.routes.iter().any(|e| format!("{} {}", e.spec.method, e.spec.path).to_uppercase() == key) {
                    problems.push(format!("route `{key}` is defined by more than one plugin"));
                }
            }
            for op in act.ops {
                if let Some(existing) = state.ops.get(&op.spec.name) {
                    problems.push(format!("op `{}` is defined by both `{}` and `{id}`", op.spec.name, existing.owner));
                } else {
                    state.ops.insert(op.spec.name.clone(), op);
                }
            }
            state.hooks.extend(act.hooks);
            state.listeners.extend(act.listeners);
            state.routes.extend(act.routes);
        }
        if !problems.is_empty() {
            return Err(problems);
        }

        Ok(Core {
            inner: Arc::new(Inner {
                name: dist.name,
                ports,
                events,
                manifests,
                settings: dist.settings,
                bound,
                state: RwLock::new(state),
                requests: Mutex::new(HashMap::new()),
            }),
        })
    }

    fn services(&self, plugin: &str) -> Services {
        let m = &self.inner.manifests[plugin];
        Services::new(
            plugin,
            Arc::new(m.allowed_capabilities()),
            self.inner.ports.clone(),
            self.inner.settings.get(plugin).cloned().unwrap_or(Value::Null),
            &m.data,
            self.clone(),
        )
    }

    pub fn ports(&self) -> &Ports {
        &self.inner.ports
    }

    pub fn authenticate(&self, credential: Option<&str>) -> Result<Identity> {
        self.inner.ports.auth.authenticate(credential)
    }

    pub fn call(&self, req: CallRequest) -> Result<CallResponse> {
        let inner = &self.inner;
        let ident = inner.ports.auth.authenticate(req.credential.as_deref())?;
        let (spec, handler, owner) = {
            let st = inner.state.read().unwrap();
            match st.ops.get(&req.op) {
                Some(e) => (e.spec.clone(), e.handler.clone(), e.owner.clone()),
                None => return Err(LinkError::new("unknown_op", format!("no operation `{}`", req.op))),
            }
        };
        if !inner.ports.policy.check(&ident, &spec.permission) {
            return Err(LinkError::permission_denied(&spec.permission));
        }
        schema::validate(&spec.input, &req.input)?;
        let ctx = Ctx::new(&ident, inner.ports.ids.new_id(), req.face.clone(), inner.ports.clock.now_ms());
        let _live = self.register(&ctx, &ident, spec.kind);
        // The key is encoded as a list so no choice of subject or key can collide with another.
        let idem_id = match (&req.idempotency_key, spec.kind) {
            (Some(k), OpKind::Command) => Some(json!([ident.subject, spec.name, k]).to_string()),
            _ => None,
        };

        let out = if spec.kind == OpKind::Command {
            // One transaction for the handler, its hooks, the event rows and the idempotency record:
            // either all of it is stored, or none of it.
            let mut out: Option<Result<PipelineOut>> = None;
            inner.ports.db.transaction(&mut || {
                let r = self.pipeline(&ctx, &spec, &handler, &owner, &req.input, idem_id.as_deref(), true);
                let verdict = r.as_ref().map(|_| ()).map_err(|e| e.clone());
                out = Some(r);
                verdict
            })?;
            out.expect("transaction ran")?
        } else {
            self.pipeline(&ctx, &spec, &handler, &owner, &req.input, None, true)?
        };
        self.after_commit(out.events, ctx.now_ms, 0);
        Ok(CallResponse { data: out.data, replayed: out.replayed })
    }

    fn register(&self, ctx: &Ctx, ident: &Identity, kind: OpKind) -> RequestGuard<'_> {
        self.inner.requests.lock().unwrap().insert(
            ctx.request_id.clone(),
            RequestInfo { ident: ident.clone(), face: ctx.face.clone(), kind, depth: 0 },
        );
        RequestGuard { map: &self.inner.requests, id: ctx.request_id.clone() }
    }

    fn pipeline(&self, ctx: &Ctx, spec: &OpSpec, handler: &OpHandler, owner: &str, input: &Value, idem: Option<&str>, append: bool) -> Result<PipelineOut> {
        let inner = &self.inner;
        if let Some(id) = idem {
            if let Some(rec) = inner.ports.db.get("_idem", id)? {
                return if rec["input"] == *input {
                    Ok(PipelineOut { data: rec["result"].clone(), events: vec![], pending: vec![], replayed: true })
                } else {
                    Err(LinkError::new("idempotency_conflict", "this idempotency key was already used with different input"))
                };
            }
        }
        let hooks: Vec<HookEntry> = {
            let st = inner.state.read().unwrap();
            let mut h: Vec<HookEntry> =
                st.hooks.iter().filter(|h| pattern_matches(&h.pattern, &spec.name)).cloned().collect();
            h.sort_by(|a, b| (a.priority, &a.owner, &a.name).cmp(&(b.priority, &b.owner, &b.name)));
            h
        };

        let mut used: Vec<Services> = vec![];
        let mut input = input.clone();
        let original = input.clone();
        for h in &hooks {
            if let HookFn::Before(f) = &h.f {
                let svc = self.services(&h.owner);
                guarded("a before-hook", || f(&ctx.for_plugin(&h.owner), spec, &mut input, &svc))?;
                used.push(svc);
            }
        }
        if input != original {
            schema::validate(&spec.input, &input)?;
        }

        let svc = self.services(owner);
        let out = guarded("a handler", || handler(&ctx.for_plugin(owner), input.clone(), &svc))?;
        used.push(svc);

        for h in &hooks {
            if let HookFn::After(f) = &h.f {
                let svc = self.services(&h.owner);
                guarded("an after-hook", || f(&ctx.for_plugin(&h.owner), spec, &input, &out, &svc))?;
                used.push(svc);
            }
        }

        let mut events = vec![];
        let mut pending = vec![];
        for s in &used {
            for p in s.take_pending() {
                if spec.kind == OpKind::Query {
                    return Err(LinkError::internal(format!("query `{}` tried to emit an event; only commands may", spec.name)));
                }
                if append {
                    events.push(inner.events.append(&p.kind, &p.plugin, &p.audience, p.data, ctx.now_ms)?);
                } else {
                    pending.push(p);
                }
            }
        }
        if let Some(id) = idem {
            let rec = json!({ "input": original, "result": out, "ts": ctx.now_ms });
            inner.ports.db.put("_idem", id, &rec)?;
        }
        Ok(PipelineOut { data: out, events, pending, replayed: false })
    }

    /// A plugin calling another plugin's op. Same user as the request being served, same policy and
    /// contract checks; events it emits are handed back so the outermost call writes them.
    pub(crate) fn call_nested(&self, caller: &str, request_id: &str, op: &str, input: Value) -> Result<(Value, Vec<PendingEvent>)> {
        let (ident, face, parent_kind, depth) = {
            let reqs = self.inner.requests.lock().unwrap();
            let Some(r) = reqs.get(request_id) else {
                return Err(LinkError::internal("plugin calls are only possible while a request is being served"));
            };
            (r.ident.clone(), r.face.clone(), r.kind, r.depth)
        };
        if depth >= 5 {
            return Err(LinkError::internal("plugin calls are nested too deeply"));
        }
        let (spec, handler, owner) = {
            let st = self.inner.state.read().unwrap();
            match st.ops.get(op) {
                Some(e) => (e.spec.clone(), e.handler.clone(), e.owner.clone()),
                None => return Err(LinkError::new("unknown_op", format!("no operation `{op}`"))),
            }
        };
        let allowed = self
            .inner
            .manifests
            .get(caller)
            .map(|m| m.requires.plugins.iter().any(|r| r.split('@').next() == Some(owner.as_str())))
            .unwrap_or(false);
        if !allowed {
            return Err(LinkError::capability_denied(caller, &format!("calling `{op}` (plugin `{owner}` is not in requires.plugins)")));
        }
        if parent_kind == OpKind::Query && spec.kind == OpKind::Command {
            return Err(LinkError::conflict(format!("a query cannot run the command `{op}`")));
        }
        if !self.inner.ports.policy.check(&ident, &spec.permission) {
            return Err(LinkError::permission_denied(&spec.permission));
        }
        schema::validate(&spec.input, &input)?;
        let ctx = Ctx::new(&ident, request_id.to_string(), face, self.inner.ports.clock.now_ms());
        if let Some(r) = self.inner.requests.lock().unwrap().get_mut(request_id) {
            r.depth += 1;
        }
        let mut out: Option<Result<PipelineOut>> = None;
        let res = self.inner.ports.db.transaction(&mut || {
            let r = self.pipeline(&ctx, &spec, &handler, &owner, &input, None, false);
            let verdict = r.as_ref().map(|_| ()).map_err(|e| e.clone());
            out = Some(r);
            verdict
        });
        if let Some(r) = self.inner.requests.lock().unwrap().get_mut(request_id) {
            r.depth -= 1;
        }
        res?;
        let o = out.expect("nested call ran")?;
        Ok((o.data, o.pending))
    }

    /// After a commit: wake readers of the log, then run listeners. Listeners are best-effort and
    /// each batch of events they emit is committed in its own transaction.
    fn after_commit(&self, events: Vec<Event>, ts: i64, depth: u8) {
        if events.is_empty() {
            return;
        }
        let audiences: std::collections::BTreeSet<&str> = events.iter().map(|e| e.audience.as_str()).collect();
        for a in audiences {
            self.inner.events.wake(a);
        }
        if depth > 8 {
            eprintln!("[nuah] event listeners are chaining too deep; stopping");
            return;
        }
        for event in events {
            let listeners: Vec<ListenerEntry> = {
                let st = self.inner.state.read().unwrap();
                st.listeners.iter().filter(|l| pattern_matches(&l.pattern, &event.kind)).cloned().collect()
            };
            let mut pending = vec![];
            for l in listeners {
                let svc = self.services(&l.owner);
                if let Err(e) = guarded("a listener", || (l.f)(&event, &svc)) {
                    eprintln!("[nuah] listener of plugin `{}` failed on `{}`: {e}", l.owner, event.kind);
                }
                pending.extend(svc.take_pending());
            }
            if pending.is_empty() {
                continue;
            }
            let mut written = vec![];
            let res = self.inner.ports.db.transaction(&mut || {
                written.clear();
                for p in &pending {
                    written.push(self.inner.events.append(&p.kind, &p.plugin, &p.audience, p.data.clone(), ts)?);
                }
                Ok(())
            });
            match res {
                Ok(()) => self.after_commit(written, ts, depth + 1),
                Err(e) => eprintln!("[nuah] could not store events emitted by listeners: {e}"),
            }
        }
    }

    /// Run a route a plugin added (the HTTP projection forwards matching requests here).
    pub fn route(
        &self,
        method: &str,
        path: &str,
        credential: Option<&str>,
        query: HashMap<String, String>,
        body: Vec<u8>,
    ) -> Result<RouteResponse> {
        let entry = {
            let st = self.inner.state.read().unwrap();
            st.routes
                .iter()
                .find(|r| r.spec.method.eq_ignore_ascii_case(method) && r.spec.path == path)
                .cloned()
                .ok_or_else(|| LinkError::not_found("route"))?
        };
        let ident = self.authenticate(credential)?;
        if !self.inner.ports.policy.check(&ident, &entry.spec.permission) {
            return Err(LinkError::permission_denied(&entry.spec.permission));
        }
        let ctx = Ctx::new(&ident, self.inner.ports.ids.new_id(), None, self.inner.ports.clock.now_ms());
        let read_only = method.eq_ignore_ascii_case("GET");
        let _live = self.register(&ctx, &ident, if read_only { OpKind::Query } else { OpKind::Command });
        let mut result: Option<RouteResponse> = None;
        let mut events: Vec<Event> = vec![];
        let mut run = || -> Result<()> {
            events.clear();
            let svc = self.services(&entry.owner);
            let res = guarded("a route handler", || {
                (entry.handler)(&ctx.for_plugin(&entry.owner), RouteRequest { query: query.clone(), body: body.clone() }, &svc)
            })?;
            for p in svc.take_pending() {
                if read_only {
                    return Err(LinkError::internal("a GET route tried to emit an event; use POST"));
                }
                events.push(self.inner.events.append(&p.kind, &p.plugin, &p.audience, p.data, ctx.now_ms)?);
            }
            result = Some(res);
            Ok(())
        };
        // GET routes read without holding a write transaction; others run as one atomic unit.
        if read_only { run()?; } else { self.inner.ports.db.transaction(&mut run)?; }
        self.after_commit(events, ctx.now_ms, 0);
        Ok(result.expect("route ran"))
    }

    pub fn events_since(&self, subject: &str, after: u64, limit: usize) -> Result<Vec<Event>> {
        self.inner.events.since(subject, after, limit)
    }
    /// The newest event the subject may see.
    pub fn latest_seq_for(&self, subject: &str) -> u64 {
        self.inner.events.latest_for(subject).unwrap_or(0)
    }
    pub fn latest_seq(&self) -> u64 {
        self.inner.events.latest_seq()
    }
    /// A wake-up signal: something was committed. Read the log to find out what.
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.inner.events.subscribe()
    }

    /// Turn a running plugin off. Everything it registered goes with it; its data stays.
    pub fn disable(&self, id: &str) -> Result<()> {
        if let Some(port) = self.inner.bound.iter().find(|(_, p)| p.as_str() == id).map(|(k, _)| k.clone()) {
            return Err(LinkError::conflict(format!("`{id}` is the adapter for port `{port}` and cannot be disabled while running")));
        }
        let mut st = self.inner.state.write().unwrap();
        if !st.active.iter().any(|a| a == id) {
            return Err(LinkError::not_found(&format!("active plugin `{id}`")));
        }
        let dependents: Vec<&String> = st
            .active
            .iter()
            .filter(|a| self.inner.manifests[*a].requires.plugins.iter().any(|r| r.split('@').next() == Some(id)))
            .collect();
        if !dependents.is_empty() {
            return Err(LinkError::conflict(format!(
                "`{id}` is required by {}; disable those first",
                dependents.iter().map(|d| format!("`{d}`")).collect::<Vec<_>>().join(", ")
            )));
        }
        st.ops.retain(|_, e| e.owner != id);
        st.hooks.retain(|h| h.owner != id);
        st.listeners.retain(|l| l.owner != id);
        st.routes.retain(|r| r.owner != id);
        st.active.retain(|a| a != id);
        st.inactive.push((id.to_string(), "disabled at runtime".to_string()));
        Ok(())
    }

    /// The core describing itself: contract, plugins, ports, slots, and (when a credential is
    /// given) who the caller is and which operations they may use.
    pub fn describe(&self, credential: Option<&str>, face: Option<&str>) -> Value {
        let inner = &self.inner;
        let identity = inner.ports.auth.authenticate(credential).ok();
        // Before sign-in a face only learns how to sign in: no plugin list, no ops, no counters.
        let Some(identity_ref) = identity.as_ref() else {
            return json!({
                "contract": CONTRACT_VERSION, "profile": inner.name, "identity": null,
                "signin": inner.ports.auth.signin(),
            });
        };
        let _ = identity_ref;
        let latest = identity.as_ref().map(|i| inner.events.latest_for(&i.subject).unwrap_or(0)).unwrap_or(0); // a db call: before taking the state lock
        let st = inner.state.read().unwrap();
        let mut ops: Vec<&OpEntry> = st.ops.values().collect();
        ops.sort_by(|a, b| a.spec.name.cmp(&b.spec.name));
        let ops_json: Vec<Value> = ops
            .iter()
            .map(|e| {
                let mut v = json!(e.spec);
                v["plugin"] = json!(e.owner);
                if let Some(id) = &identity {
                    v["allowed"] = json!(inner.ports.policy.check(id, &e.spec.permission));
                }
                v
            })
            .collect();
        let face_ok = |item: &Value| match (face, item.get("faces").and_then(|f| f.as_array())) {
            (Some(f), Some(list)) => list.iter().any(|x| x.as_str() == Some(f)),
            _ => true,
        };
        let mut slots: Vec<Value> = vec![];
        let mut assets: Vec<Value> = vec![];
        let mut plugins: Vec<Value> = vec![];
        for id in &st.active {
            let m = &inner.manifests[id];
            slots.extend(m.contributes.slots.iter().filter(|s| face_ok(s)).cloned().map(|mut s| {
                s["plugin"] = json!(id);
                s
            }));
            assets.extend(m.contributes.assets.iter().filter(|s| face_ok(s)).cloned().map(|mut s| {
                s["plugin"] = json!(id);
                s
            }));
            plugins.push(json!({"id": id, "version": m.version, "kind": m.kind, "runtime": m.runtime, "quality": m.quality, "data": m.data, "requires": m.requires.plugins}));
        }
        let ports: HashMap<&String, &String> = inner.bound.iter().collect();
        json!({
            "contract": CONTRACT_VERSION,
            "profile": inner.name,
            "ports": ports,
            "plugins": plugins,
            "inactive": st.inactive.iter().map(|(i, r)| json!({"id": i, "reason": r})).collect::<Vec<_>>(),
            "ops": ops_json,
            "slots": slots,
            "assets": assets,
            "signin": inner.ports.auth.signin(),
            "identity": identity.as_ref().map(|i| json!({"subject": i.subject, "display": i.display, "roles": i.roles})),
            "latest_seq": latest,
        })
    }
}

fn join(v: &[&String]) -> String {
    v.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
}
