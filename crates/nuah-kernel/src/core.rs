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
    inflight: Mutex<HashSet<String>>,
}

#[derive(Clone)]
pub struct Core {
    inner: Arc<Inner>,
}

struct Inflight<'a> {
    set: &'a Mutex<HashSet<String>>,
    key: String,
}
impl Drop for Inflight<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap().remove(&self.key);
    }
}

impl Core {
    /// Resolve and start. Returns every problem found, not just the first, so an operator
    /// (or the setup wizard) can fix them in one go.
    pub fn start(dist: Distribution) -> std::result::Result<Core, Vec<String>> {
        let mut problems: Vec<String> = vec![];
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
            slots.db = slots.db.or(p.db);
            slots.auth = slots.auth.or(p.auth);
            slots.policy = slots.policy.or(p.policy);
            slots.clock = slots.clock.or(p.clock);
            slots.ids = slots.ids.or(p.ids);
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
                inflight: Mutex::new(HashSet::new()),
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

        // idempotency: the same key with the same input returns the first answer
        let mut _guard = None;
        let mut idem_id = None;
        if spec.kind == OpKind::Command {
            if let Some(key) = &req.idempotency_key {
                let id = format!("{}|{}|{}", ident.subject, spec.name, key);
                if !inner.inflight.lock().unwrap().insert(id.clone()) {
                    return Err(LinkError::new("request_in_progress", "a call with this idempotency key is still running"));
                }
                _guard = Some(Inflight { set: &inner.inflight, key: id.clone() });
                if let Some(rec) = inner.ports.db.get("_idem", &id)? {
                    return if rec["input"] == req.input {
                        Ok(CallResponse { data: rec["result"].clone(), replayed: true })
                    } else {
                        Err(LinkError::new("idempotency_conflict", "this idempotency key was already used with different input"))
                    };
                }
                idem_id = Some(id);
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
        let mut input = req.input.clone();
        let mut input_changed = false;
        for h in &hooks {
            if let HookFn::Before(f) = &h.f {
                let svc = self.services(&h.owner);
                let before = input.clone();
                f(&ctx.for_plugin(&h.owner), &spec, &mut input, &svc)?;
                input_changed |= before != input;
                used.push(svc);
            }
        }
        if input_changed {
            schema::validate(&spec.input, &input)?;
        }

        let svc = self.services(&owner);
        let out = handler(&ctx.for_plugin(&owner), input.clone(), &svc)?;
        used.push(svc);

        for h in &hooks {
            if let HookFn::After(f) = &h.f {
                let svc = self.services(&h.owner);
                if let Err(e) = f(&ctx.for_plugin(&h.owner), &spec, &input, &out, &svc) {
                    eprintln!("[nuah] after-hook `{}` of plugin `{}` failed on `{}`: {e}", h.name, h.owner, spec.name);
                }
                used.push(svc);
            }
        }

        let pending: Vec<PendingEvent> = used.iter().flat_map(|s| s.take_pending()).collect();
        self.publish(pending, ctx.now_ms, 0);

        if let Some(id) = idem_id {
            let rec = json!({ "input": req.input, "result": out, "ts": ctx.now_ms });
            if let Err(e) = inner.ports.db.put("_idem", &id, &rec) {
                eprintln!("[nuah] could not remember idempotency key: {e}");
            }
        }
        Ok(CallResponse { data: out, replayed: false })
    }

    fn publish(&self, pending: Vec<PendingEvent>, ts: i64, depth: u8) {
        if depth > 8 {
            eprintln!("[nuah] event listeners are chaining too deep; dropping {} events", pending.len());
            return;
        }
        for p in pending {
            let event = match self.inner.events.append(&p.kind, &p.plugin, &p.audience, p.data, ts) {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("[nuah] could not append event `{}`: {e}", p.kind);
                    continue;
                }
            };
            let listeners: Vec<ListenerEntry> = {
                let st = self.inner.state.read().unwrap();
                st.listeners.iter().filter(|l| pattern_matches(&l.pattern, &event.kind)).cloned().collect()
            };
            let mut more = vec![];
            for l in listeners {
                let svc = self.services(&l.owner);
                if let Err(e) = (l.f)(&event, &svc) {
                    eprintln!("[nuah] listener of plugin `{}` failed on `{}`: {e}", l.owner, event.kind);
                }
                more.extend(svc.take_pending());
            }
            self.publish(more, ts, depth + 1);
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
        let (entry, ident) = {
            let st = self.inner.state.read().unwrap();
            let e = st
                .routes
                .iter()
                .find(|r| r.spec.method.eq_ignore_ascii_case(method) && r.spec.path == path)
                .cloned()
                .ok_or_else(|| LinkError::not_found("route"))?;
            (e, self.authenticate(credential)?)
        };
        if !self.inner.ports.policy.check(&ident, &entry.spec.permission) {
            return Err(LinkError::permission_denied(&entry.spec.permission));
        }
        let ctx = Ctx::new(&ident, self.inner.ports.ids.new_id(), None, self.inner.ports.clock.now_ms());
        let svc = self.services(&entry.owner);
        let res = (entry.handler)(&ctx.for_plugin(&entry.owner), RouteRequest { query, body }, &svc)?;
        let pending = svc.take_pending();
        self.publish(pending, ctx.now_ms, 0);
        Ok(res)
    }

    pub fn events_since(&self, subject: &str, after: u64, limit: usize) -> Result<Vec<Event>> {
        self.inner.events.since(subject, after, limit)
    }
    pub fn latest_seq(&self) -> u64 {
        self.inner.events.latest_seq()
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
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
        let st = inner.state.read().unwrap();
        let identity = inner.ports.auth.authenticate(credential).ok();
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
            plugins.push(json!({"id": id, "version": m.version, "kind": m.kind, "runtime": m.runtime, "quality": m.quality}));
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
            "latest_seq": inner.events.latest_seq(),
        })
    }
}

fn join(v: &[&String]) -> String {
    v.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
}
