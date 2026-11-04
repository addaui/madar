//! The conformance suite for the `db` port. Any adapter, first-party or not, must pass it.
//! Passing this suite is what makes "swap SQLite for Postgres" a configuration change.

use nuah_kernel::*;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn run_db_conformance(make: &dyn Fn() -> Arc<dyn Db>) {
    roundtrip(&*make());
    filters(&*make());
    ordering_and_paging(&*make());
    nulls_and_types(&*make());
    contains(&*make());
    batches(&*make());
    isolation(&*make());
}

fn ids(rows: &[Value]) -> Vec<String> {
    rows.iter().map(|r| r["id"].as_str().unwrap().to_string()).collect()
}

fn seed(db: &dyn Db) {
    let docs = [
        json!({"id":"a","n":3,"s":"Beta","flag":true,"nested":{"k":"x"}}),
        json!({"id":"b","n":1,"s":"alpha","flag":false,"nested":{"k":"y"}}),
        json!({"id":"c","n":2,"s":"Gamma 100%","nested":{"k":"x"}}),
        json!({"id":"d","n":2.0,"s":null}),
    ];
    for d in docs {
        db.put("t", d["id"].as_str().unwrap(), &d).unwrap();
    }
}

fn roundtrip(db: &dyn Db) {
    assert_eq!(db.get("t", "x").unwrap(), None, "missing document reads as None");
    let doc = json!({"id":"x","v":1,"deep":{"a":[1,2,{"b":null}]},"text":"héllo ✓"});
    db.put("t", "x", &doc).unwrap();
    assert_eq!(db.get("t", "x").unwrap(), Some(doc.clone()), "document round-trips exactly");
    let doc2 = json!({"id":"x","v":2});
    db.put("t", "x", &doc2).unwrap();
    assert_eq!(db.get("t", "x").unwrap(), Some(doc2), "put replaces");
    assert!(db.delete("t", "x").unwrap(), "delete reports removal");
    assert!(!db.delete("t", "x").unwrap(), "second delete reports nothing removed");
    assert!(db.put("t", "bad", &json!([1])).is_err(), "only objects are documents");
    assert!(db.get("t", "bad").unwrap().is_none());
}

fn filters(db: &dyn Db) {
    seed(db);
    let q = |f: Filter| db.query(&Query { collection: "t".into(), filters: vec![f], order_by: Some(("id".into(), false)), ..Default::default() }).unwrap();
    let f = |field: &str, op, value| Filter { field: field.into(), op, value };
    assert_eq!(ids(&q(f("n", FilterOp::Eq, json!(2)))), ["c", "d"], "1 and 1.0 are the same number");
    assert_eq!(ids(&q(f("n", FilterOp::Ne, json!(2)))), ["a", "b"]);
    assert_eq!(ids(&q(f("n", FilterOp::Lt, json!(2)))), ["b"]);
    assert_eq!(ids(&q(f("n", FilterOp::Lte, json!(2)))), ["b", "c", "d"]);
    assert_eq!(ids(&q(f("n", FilterOp::Gt, json!(2)))), ["a"]);
    assert_eq!(ids(&q(f("n", FilterOp::Gte, json!(2)))), ["a", "c", "d"]);
    assert_eq!(ids(&q(f("s", FilterOp::Eq, json!("alpha")))), ["b"]);
    assert_eq!(ids(&q(f("nested.k", FilterOp::Eq, json!("x")))), ["a", "c"], "dotted paths reach nested fields");
    assert_eq!(ids(&q(f("flag", FilterOp::Eq, json!(true)))), ["a"]);
    assert_eq!(ids(&q(f("flag", FilterOp::Eq, json!(false)))), ["b"]);
    let both = db
        .query(&Query::new("t").eq("nested.k", "x").filter("n", FilterOp::Gt, json!(2)))
        .unwrap();
    assert_eq!(ids(&both), ["a"], "filters combine with AND");
    assert!(db.query(&Query::new("t").eq("n", "2")).unwrap().is_empty(), "a string never equals a number");
}

fn ordering_and_paging(db: &dyn Db) {
    seed(db);
    let by = |field: &str, desc: bool| ids(&db.query(&Query::new("t").order(field, desc)).unwrap());
    assert_eq!(by("n", false), ["b", "c", "d", "a"], "ascending, ties by id");
    assert_eq!(by("n", true), ["a", "c", "d", "b"], "descending still breaks ties by id ascending");
    assert_eq!(by("s", false), ["d", "a", "c", "b"], "null first, then text by bytes (uppercase before lowercase)");
    assert_eq!(by("missing", false), ["a", "b", "c", "d"], "all-missing falls back to id order");
    let page = db.query(&Query { collection: "t".into(), order_by: Some(("n".into(), false)), limit: Some(2), offset: 1, ..Default::default() }).unwrap();
    assert_eq!(ids(&page), ["c", "d"], "limit and offset");
    assert!(db.query(&Query::new("nothing")).unwrap().is_empty(), "unknown collection is empty");
}

fn nulls_and_types(db: &dyn Db) {
    seed(db);
    let f = |field: &str, op, value| ids(&db.query(&Query::new("t").filter(field, op, value)).unwrap());
    assert_eq!(f("s", FilterOp::Eq, Value::Null), ["d"], "null matches null");
    assert_eq!(f("flag", FilterOp::Eq, Value::Null), ["c", "d"], "null matches a missing field");
    assert_eq!(f("flag", FilterOp::Ne, Value::Null), ["a", "b"]);
    assert_eq!(f("s", FilterOp::Gt, Value::Null), Vec::<String>::new(), "ordering against null matches nothing");
    assert_eq!(f("s", FilterOp::Lt, json!("zzz")), ["a", "b", "c"], "null fields never satisfy ordering filters");
    assert_eq!(f("missing", FilterOp::Ne, json!(1)), ["a", "b", "c", "d"], "a missing field is not equal to a value");
}

fn contains(db: &dyn Db) {
    seed(db);
    let f = |needle: &str| ids(&db.query(&Query::new("t").filter("s", FilterOp::Contains, json!(needle))).unwrap());
    assert_eq!(f("ALPHA"), ["b"], "case-insensitive for ASCII");
    assert_eq!(f("a"), ["a", "b", "c"]);
    assert_eq!(f("100%"), ["c"], "% is a literal, not a wildcard");
    assert_eq!(f("_"), Vec::<String>::new(), "_ is a literal, not a wildcard");
    assert_eq!(f(""), ["a", "b", "c"], "empty needle matches every string, never null");
}

fn batches(db: &dyn Db) {
    db.put("t", "keep", &json!({"id":"keep"})).unwrap();
    db.batch(&[
        WriteOp::Put { collection: "t".into(), id: "n1".into(), doc: json!({"id":"n1"}) },
        WriteOp::Delete { collection: "t".into(), id: "keep".into() },
    ])
    .unwrap();
    assert!(db.get("t", "n1").unwrap().is_some());
    assert!(db.get("t", "keep").unwrap().is_none());
    let result = db.batch(&[
        WriteOp::Put { collection: "t".into(), id: "n2".into(), doc: json!({"id":"n2"}) },
        WriteOp::Delete { collection: "t".into(), id: "n1".into() },
        WriteOp::Put { collection: "t".into(), id: "n3".into(), doc: json!("not an object") },
    ]);
    assert!(result.is_err(), "an invalid write fails the batch");
    assert!(db.get("t", "n2").unwrap().is_none(), "a failed batch writes nothing");
    assert!(db.get("t", "n1").unwrap().is_some(), "a failed batch deletes nothing");
}

fn isolation(db: &dyn Db) {
    db.put("one", "same", &json!({"id":"same","c":"one"})).unwrap();
    db.put("two", "same", &json!({"id":"same","c":"two"})).unwrap();
    assert_eq!(db.get("one", "same").unwrap().unwrap()["c"], "one");
    assert_eq!(db.get("two", "same").unwrap().unwrap()["c"], "two");
    assert_eq!(db.query(&Query::new("one")).unwrap().len(), 1, "collections do not leak into each other");
}
