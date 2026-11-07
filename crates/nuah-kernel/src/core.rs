//! A Core: the kernel together with its active plugins and the Adapters bound to its Ports.

use crate::db::*;
use crate::error::{Error, Result};
use crate::manifest::*;
use crate::plugin::*;
use crate::ports::*;
use crate::resolver::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::watch;

pub(crate) struct Inner {
    pub(crate) db: Arc<dyn Db>,
    pub(crate) auth: Arc<dyn Auth>,
    pub(crate) policy: Arc<dyn Policy>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) ids: Arc<dyn Ids>,
    pub(crate) plan: Plan,
    pub(crate) settings: BTreeMap<String, Value>,
    pub(crate) wake: watch::Sender<u64>,
    pub(crate) profile_name: String,
}

/// A running Core. Cheap to clone.
#[derive(Clone)]
pub struct Core {
    pub(crate) inner: Arc<Inner>,
}

impl Core {
    /// Run the Resolver alone: no Adapter is opened, no data is touched.
    pub fn check(dist: &Distribution) -> Vec<Problem> {
        resolve(dist).0
    }

    /// Resolve, open the Adapters, record who owns which collection, migrate data, and be ready.
    pub fn start(dist: &Distribution) -> std::result::Result<Core, Vec<Problem>> {
        let (mut problems, plan) = resolve(dist);
        if !problems.is_empty() {
            return Err(problems);
        }
        let mut ports: BTreeMap<&str, PortImpl> = BTreeMap::new();
        for (port, adapter) in &plan.ports {
            let ap = &plan.active[adapter];
            let settings = plan.settings.get(adapter).cloned().unwrap_or_else(|| json!({}));
            match ap.plugin.fill(&settings) {
                Ok(Some(imp)) => {
                    ports.insert(port.as_str(), imp);
                }
                Ok(None) => problems.push(Problem { code: "adapter_filled_nothing".into(), plugins: vec![adapter.clone()], message: format!("{adapter} fills no {port}") }),
                Err(e) => problems.push(Problem { code: "adapter_failed".into(), plugins: vec![adapter.clone()], message: format!("{adapter} could not start: {}", e.message) }),
            }
        }
        if !problems.is_empty() {
            return Err(problems);
        }
        macro_rules! take {
            ($port:literal, $variant:ident) => {
                match ports.remove($port) {
                    Some(PortImpl::$variant(x)) => x,
                    _ => {
                        return Err(vec![Problem { code: "wrong_port_type".into(), plugins: vec![plan.ports[$port].clone()], message: format!("the adapter for {} returned the wrong kind of port", $port) }])
                    }
                }
            };
        }
        let db = take!("db", Db);
        let auth = take!("auth", Auth);
        let policy = take!("policy", Policy);
        let clock = take!("clock", Clock);
        let ids = take!("ids", Ids);
        let (wake, _) = watch::channel(0u64);
        let settings = plan.settings.clone();
        let inner = Arc::new(Inner { db, auth, policy, clock, ids, plan, settings, wake, profile_name: dist.profile.name.clone() });
        if let Err(e) = inner.prepare_storage() {
            return Err(vec![Problem { code: "storage".into(), plugins: vec![], message: e.message }]);
        }
        if let Err(e) = inner.init_listener_cursors() {
            return Err(vec![Problem { code: "storage".into(), plugins: vec![], message: e.message }]);
        }
        let latest = {
            let mut l = 0;
            let _ = inner.db.read(&mut |r| {
                l = r.latest_change()?;
                Ok(())
            });
            l
        };
        let _ = inner.wake.send(latest);
        Ok(Core { inner })
    }

    /// A signal that moves whenever something is committed; a Face waits on it instead of polling.
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.inner.wake.subscribe()
    }
    pub fn contract_hash(&self) -> &str {
        &self.inner.plan.hash
    }
    pub fn profile_name(&self) -> &str {
        &self.inner.profile_name
    }
    pub fn plugin_ids(&self) -> Vec<String> {
        self.inner.plan.active.keys().cloned().collect()
    }
    pub fn now(&self) -> Millis {
        self.inner.clock.now()
    }
}

/// The Core's running services, started by [`Core::start_services`]. Dropping it stops them, last started first.
pub struct Services {
    started: Vec<(String, Box<dyn Service>)>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    housekeeping: Option<std::thread::JoinHandle<()>>,
}

impl Services {
    /// Ids of the plugins whose service is running.
    pub fn running(&self) -> Vec<&str> {
        self.started.iter().map(|(id, _)| id.as_str()).collect()
    }
    /// Stop everything and wait.
    pub fn stop(mut self) {
        self.shutdown();
    }
    fn shutdown(&mut self) {
        while let Some((_, s)) = self.started.pop() {
            s.stop();
        }
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(h) = self.housekeeping.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Services {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The Core's own upkeep: deliver committed Events to Listeners, trim the change log.
fn housekeeping(core: Core, stop: Arc<std::sync::atomic::AtomicBool>) {
    use std::sync::atomic::Ordering::SeqCst;
    use std::time::{Duration, Instant};
    let mut wake = core.subscribe();
    let mut rounds = 0u64;
    while !stop.load(SeqCst) {
        rounds += 1;
        if let Err(e) = core.drain_listeners() {
            eprintln!("[nuah] listener failed: {}", e.message);
        }
        if rounds % 600 == 0 {
            let _ = core.prune_log(crate::pipeline::CHANGE_RETENTION);
        }
        // A commit wakes the loop at once; once a second covers another process writing the same database.
        let started = Instant::now();
        while !stop.load(SeqCst) && started.elapsed() < Duration::from_secs(1) {
            match wake.has_changed() {
                Ok(true) => {
                    wake.borrow_and_update();
                    break;
                }
                Ok(false) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => return,
            }
        }
    }
}

impl Core {
    /// Start the Core's upkeep and the service of every plugin that asked for `serve`, in plugin id
    /// order. If one cannot start, the ones already running are stopped and the failure is returned.
    pub fn start_services(&self) -> Result<Services> {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (c, s) = (self.clone(), stop.clone());
        let housekeeping = std::thread::Builder::new().name("nuah-housekeeping".into()).spawn(move || housekeeping(c, s)).map_err(|e| Error::internal(format!("cannot start housekeeping: {e}")))?;
        let mut services = Services { started: vec![], stop, housekeeping: Some(housekeeping) };
        for (id, a) in &self.inner.plan.active {
            if !a.manifest.requires.capabilities.iter().any(|c| c == "serve") {
                continue;
            }
            let settings = self.inner.settings.get(id).cloned().unwrap_or(Value::Null);
            match a.plugin.serve(ServiceContext { core: self.clone(), settings }) {
                Ok(Some(svc)) => services.started.push((id.clone(), svc)),
                Ok(None) => {}
                Err(e) => return Err(Error::internal(format!("{id} could not start its service: {}", e.message))),
            }
        }
        Ok(services)
    }
}

impl Inner {
    pub(crate) fn manifest(&self, plugin: &str) -> Option<&Manifest> {
        self.plan.active.get(plugin).map(|a| &a.manifest)
    }
    pub(crate) fn op_decl(&self, op: &str) -> Option<&OperationDecl> {
        let owner = self.plan.ops.get(op)?;
        self.manifest(owner)?.operations.get(op)
    }
    pub(crate) fn check_capability(&self, plugin: &str, cap: &str) -> Result<()> {
        if self.plan.grants.get(plugin).is_some_and(|g| g.iter().any(|c| c == cap)) {
            Ok(())
        } else {
            Err(Error::internal(format!("plugin {plugin} was not granted the capability {cap}")))
        }
    }
    pub(crate) fn event_decl(&self, kind: &str, plugin: &str) -> Result<&EventDecl> {
        match self.plan.events.get(kind) {
            Some(owner) if owner == plugin => Ok(&self.manifest(owner).unwrap().events[kind]),
            Some(owner) => Err(Error::internal(format!("event kind {kind} belongs to {owner}, not {plugin}"))),
            None => Err(Error::internal(format!("event kind {kind} is not declared"))),
        }
    }
    pub(crate) fn extension_def(&self, point: &str) -> Option<ExtensionPointDef> {
        self.plan.ext_points.get(point).map(|(_, d)| d.clone())
    }
    pub(crate) fn providers_of(&self, point: &str) -> Vec<(String, OpFn)> {
        let mut provs = self.plan.providers.get(point).cloned().unwrap_or_default();
        provs.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        provs
            .into_iter()
            .filter_map(|(_, id)| self.plan.active.get(&id).and_then(|a| a.bindings.provides.get(point).cloned()).map(|f| (id, f)))
            .collect()
    }

    /// Record collection ownership, make indexes, and bring each plugin's data to its declared version.
    fn prepare_storage(&self) -> Result<()> {
        for (id, a) in &self.plan.active {
            // ownership is claimed once, in the database
            let mut result = Ok(());
            self.db.write(&mut |w| {
                let now = self.clock.now();
                for c in &a.manifest.data.collections {
                    let key = format!("collection:{c}");
                    match w.get("_meta", &key)? {
                        Some(d) if !d.deleted => {
                            let owner = d.body["owner"].as_str().unwrap_or("");
                            if owner != id {
                                result = Err(Error::internal(format!("the collection {c} belongs to the plugin {owner}, not {id}")));
                                return Ok(());
                            }
                        }
                        _ => {
                            w.put("_meta", &key, "kernel", json!({"owner": id}), Expect::Any, now)?;
                        }
                    }
                }
                Ok(())
            })?;
            result?;
            for ix in &a.manifest.data.indexes {
                self.db.ensure_index(&ix.collection, &ix.field)?;
            }
            // migrations, one step at a time, each in its own transaction
            let want = a.manifest.data.version;
            let mut have = 0u32;
            self.db.read(&mut |r| {
                have = r.get("_meta", &format!("version:{id}"))?.filter(|d| !d.deleted).and_then(|d| d.body["version"].as_u64()).unwrap_or(0) as u32;
                Ok(())
            })?;
            if have > want {
                return Err(Error::internal(format!("the data of {id} is at version {have}, newer than the plugin's {want}")));
            }
            for from in have..want {
                self.run_kernel(id, &mut |tx| {
                    a.plugin.migrate(from, tx)?;
                    let now = tx.now();
                    tx.wr()?.put("_meta", &format!("version:{id}"), "kernel", json!({"version": from + 1}), Expect::Any, now)?;
                    Ok(())
                })?;
            }
            if want == 0 && have == 0 {
                self.run_kernel(id, &mut |tx| {
                    let now = tx.now();
                    tx.wr()?.put("_meta", &format!("version:{id}"), "kernel", json!({"version": 0}), Expect::Any, now)?;
                    Ok(())
                })?;
            }
        }
        Ok(())
    }

    /// Run kernel-internal work as a plugin, in a write transaction, with no Subject.
    pub(crate) fn run_kernel(&self, plugin: &str, f: &mut dyn FnMut(&mut Tx) -> Result<()>) -> Result<()> {
        let system = Identity { subject: "kernel".into(), display: "kernel".into(), roles: vec![] };
        let mut out = Ok(());
        self.db.write(&mut |w| {
            let mut events = vec![];
            let mut docs = vec![];
            let mut tx = Tx { inner: self, plugin: plugin.into(), who: &system, request: "kernel", h: Handle::W(w), events: &mut events, docs: &mut docs, depth: 0 };
            out = f(&mut tx);
            if out.is_err() {
                return Err(Error::internal("rolled back"));
            }
            Ok(())
        })
        .or_else(|e| if out.is_err() { Ok(()) } else { Err(e) })?;
        out
    }
}
