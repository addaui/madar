//! Pulse: the event log behind realtime. Every event has a sequence number, so a face that
//! reconnects can say "the last one I saw was 41" and get exactly 42 onwards.
//! The log lives in the db port, so it survives restarts and works with any adapter.

use crate::error::Result;
use crate::ports::{Db, FilterOp, Query};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

const COLLECTION: &str = "_events";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub seq: u64,
    pub ts: i64,
    pub kind: String,
    /// Plugin that emitted it.
    pub plugin: String,
    /// Only this subject may see the event.
    pub audience: String,
    pub data: Value,
}

pub struct EventLog {
    db: Arc<dyn Db>,
    seq: Mutex<u64>,
    tx: broadcast::Sender<Event>,
}

impl EventLog {
    pub fn open(db: Arc<dyn Db>) -> Result<Self> {
        let last = db
            .query(&Query::new(COLLECTION).order("seq", true).limit(1))?
            .first()
            .and_then(|d| d["seq"].as_u64())
            .unwrap_or(0);
        let (tx, _) = broadcast::channel(1024);
        Ok(EventLog { db, seq: Mutex::new(last), tx })
    }

    pub fn append(&self, kind: &str, plugin: &str, audience: &str, data: Value, ts: i64) -> Result<Event> {
        let mut seq = self.seq.lock().unwrap();
        let next = *seq + 1;
        let event = Event { seq: next, ts, kind: kind.into(), plugin: plugin.into(), audience: audience.into(), data };
        self.db.put(COLLECTION, &format!("{next:012}"), &json!(event))?;
        *seq = next;
        drop(seq);
        let _ = self.tx.send(event.clone()); // no receivers is fine
        Ok(event)
    }

    /// Events for one subject after `after`, oldest first.
    pub fn since(&self, audience: &str, after: u64, limit: usize) -> Result<Vec<Event>> {
        let q = Query::new(COLLECTION)
            .eq("audience", audience)
            .filter("seq", FilterOp::Gt, json!(after))
            .order("seq", false)
            .limit(limit);
        Ok(self.db.query(&q)?.into_iter().filter_map(|d| serde_json::from_value(d).ok()).collect())
    }

    pub fn latest_seq(&self) -> u64 {
        *self.seq.lock().unwrap()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }
}
