use nuah_adapters::conformance::run_db_conformance;
use nuah_adapters::memory::MemoryDb;
use nuah_adapters::sqlite::SqliteDb;
use nuah_kernel::Db;
use std::sync::Arc;

#[test]
fn memory_adapter_conforms() {
    run_db_conformance(&|| Arc::new(MemoryDb::new()) as Arc<dyn Db>);
}

#[test]
fn sqlite_adapter_conforms() {
    run_db_conformance(&|| Arc::new(SqliteDb::open(":memory:").unwrap()) as Arc<dyn Db>);
}

#[test]
fn sqlite_file_adapter_conforms_and_persists() {
    let dir = std::env::temp_dir().join(format!("nuah-conf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("c.db");
    let p = path.to_str().unwrap().to_string();
    let _ = std::fs::remove_file(&path);
    run_db_conformance(&|| {
        let _ = std::fs::remove_file(&path);
        Arc::new(SqliteDb::open(&p).unwrap()) as Arc<dyn Db>
    });
    let db = SqliteDb::open(&p).unwrap();
    db.put("t", "p", &serde_json::json!({"id":"p"})).unwrap();
    drop(db);
    assert!(SqliteDb::open(&p).unwrap().get("t", "p").unwrap().is_some(), "data survives reopen");
    let _ = std::fs::remove_dir_all(&dir);
}
