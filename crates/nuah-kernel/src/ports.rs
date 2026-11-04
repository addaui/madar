//! Ports: the interfaces the core calls. Adapters implement them. Plugins never see an adapter.
//! Each port is deliberately narrow so that more than one adapter can pass its conformance suite.

use crate::error::Result;
use serde_json::Value;
use std::sync::Arc;

/// Ports the kernel knows about. A distribution must bind each one to exactly one adapter.
pub const PORT_NAMES: [&str; 5] = ["db", "auth", "policy", "clock", "ids"];

// ---------- db ----------

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FilterOp {
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    /// Case-insensitive substring match on a string field.
    Contains,
}

#[derive(Debug, Clone)]
pub struct Filter {
    pub field: String,
    pub op: FilterOp,
    pub value: Value,
}

#[derive(Debug, Clone, Default)]
pub struct Query {
    pub collection: String,
    pub filters: Vec<Filter>,
    /// (field, descending). Ties are always broken by id ascending so results are deterministic.
    pub order_by: Option<(String, bool)>,
    pub limit: Option<usize>,
    pub offset: usize,
}

impl Query {
    pub fn new(collection: &str) -> Self {
        Query { collection: collection.to_string(), ..Default::default() }
    }
    pub fn filter(mut self, field: &str, op: FilterOp, value: Value) -> Self {
        self.filters.push(Filter { field: field.to_string(), op, value });
        self
    }
    pub fn eq(self, field: &str, value: impl Into<Value>) -> Self {
        self.filter(field, FilterOp::Eq, value.into())
    }
    pub fn order(mut self, field: &str, descending: bool) -> Self {
        self.order_by = Some((field.to_string(), descending));
        self
    }
    pub fn limit(mut self, n: usize) -> Self {
        self.limit = Some(n);
        self
    }
}

#[derive(Debug, Clone)]
pub enum WriteOp {
    Put { collection: String, id: String, doc: Value },
    Delete { collection: String, id: String },
}

/// Document storage. Documents are JSON objects addressed by (collection, id).
/// Optional features are announced through `capabilities()` so a plugin can refuse to start
/// on an adapter that lacks them. None are defined yet.
pub trait Db: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> Vec<String> {
        vec![]
    }
    fn get(&self, collection: &str, id: &str) -> Result<Option<Value>>;
    /// Insert only if the id is free. Returns false when it already exists.
    fn put_new(&self, collection: &str, id: &str, doc: &Value) -> Result<bool>;
    /// Run `f` as one atomic unit: its writes all commit together, or none do when it returns an
    /// error (or panics). Transactions are serialized with each other and with every other call on
    /// this db, so nothing inside sees half-done work and read-then-write cannot lose updates.
    /// Calls that `f` makes on this same db join the transaction; nesting joins the outer one.
    fn transaction(&self, f: &mut dyn FnMut() -> Result<()>) -> Result<()>;
    /// Insert or replace.
    fn put(&self, collection: &str, id: &str, doc: &Value) -> Result<()>;
    /// Returns true when something was removed.
    fn delete(&self, collection: &str, id: &str) -> Result<bool>;
    fn query(&self, q: &Query) -> Result<Vec<Value>>;
    /// All-or-nothing.
    fn batch(&self, ops: &[WriteOp]) -> Result<()>;
}

/// Field paths are dotted names such as `nested.k`. Adapters must all accept the same syntax.
pub fn check_field_path(field: &str) -> Result<()> {
    let ok = !field.is_empty()
        && field.split('.').all(|seg| {
            let mut c = seg.chars();
            c.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_') && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
        });
    if ok {
        Ok(())
    } else {
        Err(crate::error::LinkError::new("db_error", format!("invalid field path `{field}`")))
    }
}

/// Filters compare scalars only. Adapters must reject objects and arrays instead of guessing.
pub fn check_query(q: &Query) -> Result<()> {
    for f in &q.filters {
        check_field_path(&f.field)?;
        if f.value.is_object() || f.value.is_array() {
            return Err(crate::error::LinkError::new("db_error", format!("filter on `{}` must compare a scalar", f.field)));
        }
    }
    if let Some((f, _)) = &q.order_by {
        check_field_path(f)?;
    }
    Ok(())
}

// ---------- auth ----------

#[derive(Debug, Clone, PartialEq)]
pub struct Identity {
    pub subject: String,
    pub display: String,
    pub roles: Vec<String>,
}

pub trait Auth: Send + Sync {
    fn id(&self) -> &str;
    /// Verify a credential. `None` means the caller sent nothing.
    fn authenticate(&self, credential: Option<&str>) -> Result<Identity>;
    /// A declarative description of how to sign in, rendered by any face that has no
    /// dedicated screen for this adapter. `{"kind":"none"}` means no sign-in is needed.
    fn signin(&self) -> Value;
}

// ---------- policy ----------

pub trait Policy: Send + Sync {
    fn id(&self) -> &str;
    fn check(&self, who: &Identity, permission: &str) -> bool;
}

// ---------- clock and ids ----------

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub trait Ids: Send + Sync {
    fn new_id(&self) -> String;
}

/// The bound adapters, one per port.
pub struct Ports {
    pub db: Arc<dyn Db>,
    pub auth: Arc<dyn Auth>,
    pub policy: Arc<dyn Policy>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn Ids>,
}
