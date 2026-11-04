//! In-memory db adapter. Used for tests and throwaway instances, and as the reference
//! behavior that the SQLite adapter is compared against.

use nuah_kernel::*;
use parking_lot::ReentrantMutex;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::Arc;

type Data = BTreeMap<String, BTreeMap<String, Value>>;

struct Inner {
    data: RefCell<Data>,
    depth: Cell<u32>,
}

pub struct MemoryDb {
    // Re-entrant so a transaction can hold the lock while the calls inside it take it again.
    inner: ReentrantMutex<Inner>,
}

impl Default for MemoryDb {
    fn default() -> Self {
        MemoryDb { inner: ReentrantMutex::new(Inner { data: RefCell::new(BTreeMap::new()), depth: Cell::new(0) }) }
    }
}

impl MemoryDb {
    pub fn new() -> Self {
        Self::default()
    }
}

fn field(doc: &Value, path: &str) -> Value {
    let mut cur = doc;
    for part in path.split('.') {
        match cur.get(part) {
            Some(v) => cur = v,
            None => return Value::Null,
        }
    }
    // SQLite's json_extract returns objects and arrays as JSON text, so they behave like strings.
    match cur {
        Value::Object(_) | Value::Array(_) => Value::String(cur.to_string()),
        other => other.clone(),
    }
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Null => 0,
        Value::Bool(_) | Value::Number(_) => 1,
        _ => 2,
    }
}

/// Same ordering SQLite uses for json_extract results: null < numbers (bools count as 0/1) < text.
/// Integers compare exactly; only mixed int/float comparisons go through f64.
fn compare(a: &Value, b: &Value) -> Ordering {
    let (ra, rb) = (rank(a), rank(b));
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (Value::String(x), Value::String(y)) => x.as_bytes().cmp(y.as_bytes()),
        _ if ra == 1 => match (int(a), int(b)) {
            (Some(x), Some(y)) => x.cmp(&y),
            _ => num(a).partial_cmp(&num(b)).unwrap_or(Ordering::Equal),
        },
        _ => Ordering::Equal,
    }
}

fn int(v: &Value) -> Option<i128> {
    match v {
        Value::Bool(b) => Some(*b as i128),
        Value::Number(n) => n.as_i64().map(|i| i as i128).or_else(|| n.as_u64().map(|u| u as i128)),
        _ => None,
    }
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Bool(b) => *b as i32 as f64,
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn matches(doc: &Value, f: &Filter) -> bool {
    let actual = field(doc, &f.field);
    match f.op {
        FilterOp::Eq => compare(&actual, &f.value) == Ordering::Equal,
        FilterOp::Ne => compare(&actual, &f.value) != Ordering::Equal,
        FilterOp::Contains => match (actual.as_str(), f.value.as_str()) {
            (Some(a), Some(n)) => a.to_ascii_lowercase().contains(&n.to_ascii_lowercase()),
            _ => false,
        },
        op => {
            if actual.is_null() || f.value.is_null() {
                return false;
            }
            let o = compare(&actual, &f.value);
            match op {
                FilterOp::Lt => o == Ordering::Less,
                FilterOp::Lte => o != Ordering::Greater,
                FilterOp::Gt => o == Ordering::Greater,
                FilterOp::Gte => o != Ordering::Less,
                _ => unreachable!(),
            }
        }
    }
}

pub(crate) fn require_object(doc: &Value) -> Result<()> {
    if doc.is_object() {
        Ok(())
    } else {
        Err(LinkError::new("db_error", "documents must be JSON objects"))
    }
}

impl Db for MemoryDb {
    fn id(&self) -> &str {
        "adapter-memory"
    }
    fn get(&self, collection: &str, id: &str) -> Result<Option<Value>> {
        let g = self.inner.lock();
        let d = g.data.borrow();
        Ok(d.get(collection).and_then(|c| c.get(id)).cloned())
    }
    fn put_new(&self, collection: &str, id: &str, doc: &Value) -> Result<bool> {
        require_object(doc)?;
        let g = self.inner.lock();
        let mut d = g.data.borrow_mut();
        let col = d.entry(collection.into()).or_default();
        if col.contains_key(id) {
            return Ok(false);
        }
        col.insert(id.into(), doc.clone());
        Ok(true)
    }
    fn put(&self, collection: &str, id: &str, doc: &Value) -> Result<()> {
        require_object(doc)?;
        let g = self.inner.lock();
        g.data.borrow_mut().entry(collection.into()).or_default().insert(id.into(), doc.clone());
        Ok(())
    }
    fn delete(&self, collection: &str, id: &str) -> Result<bool> {
        let g = self.inner.lock();
        let removed = g.data.borrow_mut().get_mut(collection).and_then(|c| c.remove(id)).is_some();
        Ok(removed)
    }
    fn query(&self, q: &Query) -> Result<Vec<Value>> {
        check_query(q)?;
        let g = self.inner.lock();
        let data = g.data.borrow();
        let Some(col) = data.get(&q.collection) else { return Ok(vec![]) };
        let mut rows: Vec<(&String, &Value)> =
            col.iter().filter(|(_, d)| q.filters.iter().all(|f| matches(d, f))).collect();
        if let Some((fld, desc)) = &q.order_by {
            rows.sort_by(|a, b| {
                let o = compare(&field(a.1, fld), &field(b.1, fld));
                let o = if *desc { o.reverse() } else { o };
                o.then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
            });
        }
        Ok(rows.into_iter().skip(q.offset).take(q.limit.unwrap_or(usize::MAX)).map(|(_, d)| d.clone()).collect())
    }
    fn batch(&self, ops: &[WriteOp]) -> Result<()> {
        for op in ops {
            if let WriteOp::Put { doc, .. } = op {
                require_object(doc)?;
            }
        }
        self.transaction(&mut || {
            for op in ops {
                match op {
                    WriteOp::Put { collection, id, doc } => self.put(collection, id, doc)?,
                    WriteOp::Delete { collection, id } => {
                        self.delete(collection, id)?;
                    }
                }
            }
            Ok(())
        })
    }
    fn transaction(&self, f: &mut dyn FnMut() -> Result<()>) -> Result<()> {
        let g = self.inner.lock();
        if g.depth.get() > 0 {
            return f(); // joins the outer transaction
        }
        let snapshot = g.data.borrow().clone();
        g.depth.set(1);
        let result = catch_unwind(AssertUnwindSafe(|| f()));
        g.depth.set(0);
        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => {
                *g.data.borrow_mut() = snapshot;
                Err(e)
            }
            Err(panic) => {
                *g.data.borrow_mut() = snapshot;
                resume_unwind(panic)
            }
        }
    }
}

pub struct MemoryDbPlugin;

impl Plugin for MemoryDbPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            r#"{"id":"adapter-memory","version":"0.1.0","kind":"adapter","implements":[{"port":"db"}],"quality":"reference"}"#,
        )
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        act.provide_db(Arc::new(MemoryDb::new()));
        Ok(())
    }
}
