//! SQLite db adapter. One table of JSON documents; fields are read with json_extract.
//! Field paths and values are always bound as parameters, never spliced into SQL.
//!
//! Transactions use BEGIN IMMEDIATE on a single shared connection that sits behind a re-entrant
//! lock, so they are serialized in this process and, through SQLite's file lock, across processes.

use crate::memory::require_object;
use nuah_kernel::*;
use parking_lot::ReentrantMutex;
use rusqlite::{params_from_iter, types::Value as Sql, Connection, OptionalExtension};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::Arc;

struct Inner {
    conn: RefCell<Connection>,
    depth: Cell<u32>,
}

pub struct SqliteDb {
    inner: ReentrantMutex<Inner>,
}

fn db_err(e: rusqlite::Error) -> LinkError {
    LinkError::new("db_error", e.to_string())
}

impl SqliteDb {
    /// `path` may be ":memory:".
    pub fn open(path: &str) -> Result<Self> {
        let conn = if path == ":memory:" { Connection::open_in_memory() } else { Connection::open(path) }.map_err(db_err)?;
        if path != ":memory:" {
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").map_err(db_err)?;
        }
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(db_err)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS docs (
                collection TEXT NOT NULL,
                id TEXT NOT NULL,
                body TEXT NOT NULL,
                PRIMARY KEY (collection, id)
             ) WITHOUT ROWID;
             DROP INDEX IF EXISTS idx_events_seq;
             CREATE INDEX IF NOT EXISTS idx_events_seq2 ON docs (collection, json_extract(body, '$.seq'));",
        )
        .map_err(db_err)?;
        Ok(SqliteDb { inner: ReentrantMutex::new(Inner { conn: RefCell::new(conn), depth: Cell::new(0) }) })
    }
}

/// `json_extract(body, '$.a.b')` with the path written into the SQL. This is safe because
/// `check_field_path` only lets letters, digits, `_` and `.` through, and it lets SQLite match
/// an expression index (a bound parameter would hide the path from the planner).
fn extract(field: &str) -> Result<String> {
    check_field_path(field)?;
    Ok(format!("json_extract(body, '$.{field}')"))
}

fn to_sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

impl Db for SqliteDb {
    fn id(&self) -> &str {
        "adapter-sqlite"
    }

    fn get(&self, collection: &str, id: &str) -> Result<Option<Value>> {
        let g = self.inner.lock();
        let conn = g.conn.borrow();
        let body: Option<String> = conn
            .query_row("SELECT body FROM docs WHERE collection = ?1 AND id = ?2", [collection, id], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(body.and_then(|b| serde_json::from_str(&b).ok()))
    }

    fn put_new(&self, collection: &str, id: &str, doc: &Value) -> Result<bool> {
        require_object(doc)?;
        let g = self.inner.lock();
        let conn = g.conn.borrow();
        let n = conn
            .execute(
                "INSERT INTO docs (collection, id, body) VALUES (?1, ?2, ?3) ON CONFLICT (collection, id) DO NOTHING",
                [collection, id, &doc.to_string()],
            )
            .map_err(db_err)?;
        Ok(n > 0)
    }

    fn put(&self, collection: &str, id: &str, doc: &Value) -> Result<()> {
        require_object(doc)?;
        let g = self.inner.lock();
        let conn = g.conn.borrow();
        conn.execute(
            "INSERT INTO docs (collection, id, body) VALUES (?1, ?2, ?3)
             ON CONFLICT (collection, id) DO UPDATE SET body = excluded.body",
            [collection, id, &doc.to_string()],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn ensure_index(&self, collection: &str, field: &str) -> Result<()> {
        let plain = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !plain(collection) {
            return Err(LinkError::new("db_error", format!("invalid collection name `{collection}`")));
        }
        let expr = extract(field)?;
        let name = format!("idx_c_{collection}_{}", field.replace('.', "__"));
        let g = self.inner.lock();
        let conn = g.conn.borrow();
        conn.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS {name} ON docs (collection, {expr})"
        ))
        .map_err(db_err)
    }

    fn delete(&self, collection: &str, id: &str) -> Result<bool> {
        let g = self.inner.lock();
        let conn = g.conn.borrow();
        let n = conn.execute("DELETE FROM docs WHERE collection = ?1 AND id = ?2", [collection, id]).map_err(db_err)?;
        Ok(n > 0)
    }

    fn query(&self, q: &Query) -> Result<Vec<Value>> {
        check_query(q)?;
        let mut sql = String::from("SELECT body FROM docs WHERE collection = ?");
        let mut params: Vec<Sql> = vec![Sql::Text(q.collection.clone())];
        for f in &q.filters {
            let x = extract(&f.field)?;
            match (f.op, &f.value) {
                (FilterOp::Eq, Value::Null) => sql.push_str(&format!(" AND {x} IS NULL")),
                (FilterOp::Ne, Value::Null) => sql.push_str(&format!(" AND {x} IS NOT NULL")),
                (FilterOp::Eq, v) => {
                    sql.push_str(&format!(" AND {x} = ?"));
                    params.push(to_sql(v));
                }
                (FilterOp::Ne, v) => {
                    sql.push_str(&format!(" AND {x} IS NOT ?"));
                    params.push(to_sql(v));
                }
                (FilterOp::Contains, Value::String(s)) => {
                    sql.push_str(&format!(" AND typeof({x}) = 'text' AND lower({x}) LIKE '%' || lower(?) || '%' ESCAPE '\\'"));
                    params.push(Sql::Text(escape_like(s)));
                }
                (FilterOp::Contains, _) => sql.push_str(" AND 0"),
                (op, v) => {
                    if v.is_null() {
                        sql.push_str(" AND 0");
                        continue;
                    }
                    let cmp = match op {
                        FilterOp::Lt => "<",
                        FilterOp::Lte => "<=",
                        FilterOp::Gt => ">",
                        _ => ">=",
                    };
                    sql.push_str(&format!(" AND {x} {cmp} ?"));
                    params.push(to_sql(v));
                }
            }
        }
        match &q.order_by {
            Some((field, desc)) => {
                sql.push_str(&format!(" ORDER BY {} {}, id ASC", extract(field)?, if *desc { "DESC" } else { "ASC" }));
            }
            None => sql.push_str(" ORDER BY id ASC"),
        }
        sql.push_str(" LIMIT ? OFFSET ?");
        params.push(Sql::Integer(q.limit.map(|l| l as i64).unwrap_or(-1)));
        params.push(Sql::Integer(q.offset as i64));

        let g = self.inner.lock();
        let conn = g.conn.borrow();
        let mut stmt = conn.prepare_cached(&sql).map_err(db_err)?;
        let rows = stmt.query_map(params_from_iter(params), |r| r.get::<_, String>(0)).map_err(db_err)?;
        let mut out = vec![];
        for row in rows {
            let body = row.map_err(db_err)?;
            out.push(serde_json::from_str(&body).map_err(|e| LinkError::new("db_error", e.to_string()))?);
        }
        Ok(out)
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
        let depth = g.depth.get();
        // The outermost level is a real transaction; inner levels are savepoints, so an inner
        // failure that the caller handles undoes only the inner work.
        let (begin, commit, rollback) = if depth == 0 {
            ("BEGIN IMMEDIATE".to_string(), "COMMIT".to_string(), "ROLLBACK".to_string())
        } else {
            let sp = format!("sp{depth}");
            (format!("SAVEPOINT {sp}"), format!("RELEASE {sp}"), format!("ROLLBACK TO {sp}; RELEASE {sp}"))
        };
        g.conn.borrow().execute_batch(&begin).map_err(db_err)?;
        g.depth.set(depth + 1);
        let result = catch_unwind(AssertUnwindSafe(|| f()));
        g.depth.set(depth);
        match result {
            Ok(Ok(())) => match g.conn.borrow().execute_batch(&commit) {
                Ok(()) => Ok(()),
                Err(e) => {
                    let _ = g.conn.borrow().execute_batch(&rollback);
                    Err(db_err(e))
                }
            },
            Ok(Err(e)) => {
                let _ = g.conn.borrow().execute_batch(&rollback);
                Err(e)
            }
            Err(panic) => {
                let _ = g.conn.borrow().execute_batch(&rollback);
                resume_unwind(panic)
            }
        }
    }
}

pub struct SqliteDbPlugin;

impl Plugin for SqliteDbPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            r#"{"id":"adapter-sqlite","version":"0.1.0","kind":"adapter","implements":[{"port":"db"}],"quality":"reference"}"#,
        )
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        let path = act.settings().get("path").and_then(|p| p.as_str()).unwrap_or(":memory:").to_string();
        act.provide_db(Arc::new(SqliteDb::open(&path)?));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan(db: &SqliteDb, q: &Query) -> String {
        // same SQL shape as `query`, asked to explain itself
        let g = db.inner.lock();
        let conn = g.conn.borrow();
        let mut sql = String::from("EXPLAIN QUERY PLAN SELECT body FROM docs WHERE collection = ?");
        for f in &q.filters {
            let x = extract(&f.field).unwrap();
            sql.push_str(&format!(" AND {x} > ?"));
        }
        if let Some((f, d)) = &q.order_by {
            sql.push_str(&format!(" ORDER BY {} {}", extract(f).unwrap(), if *d { "DESC" } else { "ASC" }));
        }
        sql.push_str(" LIMIT 1");
        let mut stmt = conn.prepare(&sql).unwrap();
        let n = q.filters.len() + 1;
        let params: Vec<Sql> = std::iter::once(Sql::Text(q.collection.clone())).chain((1..n).map(|_| Sql::Integer(0))).collect();
        let rows: Vec<String> = stmt.query_map(params_from_iter(params), |r| r.get::<_, String>(3)).unwrap().map(|r| r.unwrap()).collect();
        rows.join(" | ")
    }

    #[test]
    fn the_event_queries_use_the_index_and_need_no_sorting() {
        let db = SqliteDb::open(":memory:").unwrap();
        db.put("_events", "1", &json!({"seq": 1, "audience": "a"})).unwrap();
        let newest = plan(&db, &Query::new("_events").order("seq", true));
        assert!(newest.contains("idx_events_seq2") && !newest.contains("TEMP B-TREE"), "max-seq lookup: {newest}");
        let after = plan(&db, &Query::new("_events").filter("seq", FilterOp::Gt, json!(5)).order("seq", false));
        assert!(after.contains("idx_events_seq2") && !after.contains("TEMP B-TREE"), "read-after-N: {after}");
    }

    #[test]
    fn an_index_requested_by_a_plugin_is_used_and_rejects_bad_names() {
        let db = SqliteDb::open(":memory:").unwrap();
        let q = Query::new("tasks").filter("project_id", FilterOp::Gt, json!(0));
        assert!(!plan(&db, &q).contains("idx_c_"), "no index yet");
        db.ensure_index("tasks", "project_id").unwrap();
        db.ensure_index("tasks", "project_id").unwrap(); // twice is fine
        assert!(plan(&db, &q).contains("idx_c_tasks_project_id"), "{}", plan(&db, &q));
        assert!(db.ensure_index("tasks; drop table docs", "x").is_err());
        assert!(db.ensure_index("tasks", "a b").is_err());
    }
}
