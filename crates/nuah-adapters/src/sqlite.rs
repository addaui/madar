//! SQLite db adapter. One table of JSON documents; fields are read with json_extract.
//! Field paths and values are always bound as parameters, never spliced into SQL.

use crate::memory::require_object;
use nuah_kernel::*;
use rusqlite::{params_from_iter, types::Value as Sql, Connection, OptionalExtension};
use serde_json::Value;
use std::sync::{Arc, Mutex};

pub struct SqliteDb {
    conn: Mutex<Connection>,
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
             CREATE INDEX IF NOT EXISTS idx_events_seq ON docs (json_extract(body, '$.seq')) WHERE collection = '_events';",
        )
        .map_err(db_err)?;
        Ok(SqliteDb { conn: Mutex::new(conn) })
    }
}

fn path_param(field: &str) -> Result<Sql> {
    if field.is_empty() || !field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
        return Err(LinkError::new("db_error", format!("invalid field path `{field}`")));
    }
    Ok(Sql::Text(format!("$.{field}")))
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
        let conn = self.conn.lock().unwrap();
        let body: Option<String> = conn
            .query_row("SELECT body FROM docs WHERE collection = ?1 AND id = ?2", [collection, id], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(body.and_then(|b| serde_json::from_str(&b).ok()))
    }

    fn put(&self, collection: &str, id: &str, doc: &Value) -> Result<()> {
        require_object(doc)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO docs (collection, id, body) VALUES (?1, ?2, ?3)
             ON CONFLICT (collection, id) DO UPDATE SET body = excluded.body",
            [collection, id, &doc.to_string()],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn delete(&self, collection: &str, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM docs WHERE collection = ?1 AND id = ?2", [collection, id]).map_err(db_err)?;
        Ok(n > 0)
    }

    fn query(&self, q: &Query) -> Result<Vec<Value>> {
        let mut sql = String::from("SELECT body FROM docs WHERE collection = ?");
        let mut params: Vec<Sql> = vec![Sql::Text(q.collection.clone())];
        for f in &q.filters {
            let path = path_param(&f.field)?;
            match (f.op, &f.value) {
                (FilterOp::Eq, Value::Null) => {
                    sql.push_str(" AND json_extract(body, ?) IS NULL");
                    params.push(path);
                }
                (FilterOp::Ne, Value::Null) => {
                    sql.push_str(" AND json_extract(body, ?) IS NOT NULL");
                    params.push(path);
                }
                (FilterOp::Eq, v) => {
                    sql.push_str(" AND json_extract(body, ?) = ?");
                    params.push(path);
                    params.push(to_sql(v));
                }
                (FilterOp::Ne, v) => {
                    sql.push_str(" AND json_extract(body, ?) IS NOT ?");
                    params.push(path);
                    params.push(to_sql(v));
                }
                (FilterOp::Contains, Value::String(s)) => {
                    sql.push_str(" AND typeof(json_extract(body, ?)) = 'text' AND lower(json_extract(body, ?)) LIKE '%' || lower(?) || '%' ESCAPE '\\'");
                    params.push(path.clone());
                    params.push(path);
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
                    sql.push_str(&format!(" AND json_extract(body, ?) {cmp} ?"));
                    params.push(path);
                    params.push(to_sql(v));
                }
            }
        }
        match &q.order_by {
            Some((field, desc)) => {
                sql.push_str(&format!(" ORDER BY json_extract(body, ?) {}, id ASC", if *desc { "DESC" } else { "ASC" }));
                params.push(path_param(field)?);
            }
            None => sql.push_str(" ORDER BY id ASC"),
        }
        sql.push_str(" LIMIT ? OFFSET ?");
        params.push(Sql::Integer(q.limit.map(|l| l as i64).unwrap_or(-1)));
        params.push(Sql::Integer(q.offset as i64));

        let conn = self.conn.lock().unwrap();
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
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(db_err)?;
        for op in ops {
            match op {
                WriteOp::Put { collection, id, doc } => {
                    tx.execute(
                        "INSERT INTO docs (collection, id, body) VALUES (?1, ?2, ?3)
                         ON CONFLICT (collection, id) DO UPDATE SET body = excluded.body",
                        [collection.as_str(), id.as_str(), &doc.to_string()],
                    )
                    .map_err(db_err)?;
                }
                WriteOp::Delete { collection, id } => {
                    tx.execute("DELETE FROM docs WHERE collection = ?1 AND id = ?2", [collection.as_str(), id.as_str()])
                        .map_err(db_err)?;
                }
            }
        }
        tx.commit().map_err(db_err)
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
