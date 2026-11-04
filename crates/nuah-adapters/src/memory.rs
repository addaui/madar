//! In-memory db adapter. Used for tests and throwaway instances, and as the reference
//! behavior that the SQLite adapter is compared against.

use nuah_kernel::*;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct MemoryDb {
    data: Mutex<BTreeMap<String, BTreeMap<String, Value>>>,
}

impl MemoryDb {
    pub fn new() -> Self {
        Self::default()
    }
}

fn field<'a>(doc: &'a Value, path: &str) -> &'a Value {
    let mut cur = doc;
    for part in path.split('.') {
        match cur.get(part) {
            Some(v) => cur = v,
            None => return &Value::Null,
        }
    }
    cur
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Null => 0,
        Value::Bool(_) | Value::Number(_) => 1,
        Value::String(_) => 2,
        _ => 3,
    }
}

/// Same ordering SQLite uses for json_extract results: null < numbers (bools count as 0/1) < text.
pub(crate) fn compare(a: &Value, b: &Value) -> Ordering {
    let (ra, rb) = (rank(a), rank(b));
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (Value::String(x), Value::String(y)) => x.as_bytes().cmp(y.as_bytes()),
        _ if ra == 1 => num(a).partial_cmp(&num(b)).unwrap_or(Ordering::Equal),
        _ => Ordering::Equal,
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
        FilterOp::Eq => compare(actual, &f.value) == Ordering::Equal,
        FilterOp::Ne => compare(actual, &f.value) != Ordering::Equal,
        FilterOp::Contains => match (actual.as_str(), f.value.as_str()) {
            (Some(a), Some(n)) => a.to_ascii_lowercase().contains(&n.to_ascii_lowercase()),
            _ => false,
        },
        op => {
            if actual.is_null() || f.value.is_null() {
                return false;
            }
            let o = compare(actual, &f.value);
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
        Ok(self.data.lock().unwrap().get(collection).and_then(|c| c.get(id)).cloned())
    }
    fn put(&self, collection: &str, id: &str, doc: &Value) -> Result<()> {
        require_object(doc)?;
        self.data.lock().unwrap().entry(collection.into()).or_default().insert(id.into(), doc.clone());
        Ok(())
    }
    fn delete(&self, collection: &str, id: &str) -> Result<bool> {
        Ok(self.data.lock().unwrap().get_mut(collection).and_then(|c| c.remove(id)).is_some())
    }
    fn query(&self, q: &Query) -> Result<Vec<Value>> {
        let data = self.data.lock().unwrap();
        let Some(col) = data.get(&q.collection) else { return Ok(vec![]) };
        let mut rows: Vec<(&String, &Value)> =
            col.iter().filter(|(_, d)| q.filters.iter().all(|f| matches(d, f))).collect();
        if let Some((fld, desc)) = &q.order_by {
            rows.sort_by(|a, b| {
                let o = compare(field(a.1, fld), field(b.1, fld));
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
        let mut data = self.data.lock().unwrap();
        for op in ops {
            match op {
                WriteOp::Put { collection, id, doc } => {
                    data.entry(collection.clone()).or_default().insert(id.clone(), doc.clone());
                }
                WriteOp::Delete { collection, id } => {
                    if let Some(c) = data.get_mut(collection) {
                        c.remove(id);
                    }
                }
            }
        }
        Ok(())
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
