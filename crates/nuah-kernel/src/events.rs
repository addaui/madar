//! Pulse: the event log behind realtime. Every event has a sequence number, so a face that
//! reconnects can say "the last one I saw was 41" and get exactly 42 onwards.
//! The log lives in the db port, so it survives restarts and works with any adapter.
//!
//! Sequence numbers are assigned inside the same transaction that writes the data, from the
//! highest number already in the log. That keeps them gapless and unique even when several
//! processes share one database file. The broadcast channel is only a wake-up call: readers always
//! read events back from the log in order, so a late or lost wake-up can delay an event but never
//! lose or reorder it.

use crate::error::{LinkError, Result};
use crate::ports::{Db, FilterOp, Query};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
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
    wake: broadcast::Sender<u64>,
}

impl EventLog {
    pub fn open(db: Arc<dyn Db>) -> Result<Self> {
        let (wake, _) = broadcast::channel(64);
        Ok(EventLog { db, wake })
    }

    fn max_seq(&self) -> Result<u64> {
        Ok(self.db.query(&Query::new(COLLECTION).order("seq", true).limit(1))?.first().and_then(|d| d["seq"].as_u64()).unwrap_or(0))
    }

    /// Write one event. Call this inside the transaction of the change that caused it.
    pub fn append(&self, kind: &str, plugin: &str, audience: &str, data: Value, ts: i64) -> Result<Event> {
        let seq = self.max_seq()? + 1;
        let event = Event { seq, ts, kind: kind.into(), plugin: plugin.into(), audience: audience.into(), data };
        if !self.db.put_new(COLLECTION, &format!("{seq:012}"), &json!(event))? {
            return Err(LinkError::internal("event sequence collision"));
        }
        Ok(event)
    }

    /// Tell readers to look at the log. Call after the transaction committed.
    pub fn wake(&self, latest: u64) {
        let _ = self.wake.send(latest);
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

    /// The newest event this subject can see (0 when none).
    pub fn latest_for(&self, audience: &str) -> Result<u64> {
        let q = Query::new(COLLECTION).eq("audience", audience).order("seq", true).limit(1);
        Ok(self.db.query(&q)?.first().and_then(|d| d["seq"].as_u64()).unwrap_or(0))
    }

    pub fn latest_seq(&self) -> u64 {
        self.max_seq().unwrap_or(0)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<u64> {
        self.wake.subscribe()
    }
}
