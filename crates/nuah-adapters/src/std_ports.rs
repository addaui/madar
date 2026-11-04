//! Clock and id adapters. `std` talks to the real world; `std-fixed` is deterministic,
//! so a whole session can be replayed and compared byte for byte.

use nuah_kernel::*;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

struct SystemClock;
impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
    }
}

struct UuidIds;
impl Ids for UuidIds {
    /// Random UUIDs. v7 was tried first, but its leading digits are the timestamp, so every id made
    /// within weeks shares the same visible prefix, which breaks short ids in a terminal.
    fn new_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}

pub struct StdPlugin;
impl Plugin for StdPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            r#"{"id":"std","version":"0.1.0","kind":"adapter","implements":[{"port":"clock"},{"port":"ids"}],"quality":"reference"}"#,
        )
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        act.provide_clock(Arc::new(SystemClock));
        act.provide_ids(Arc::new(UuidIds));
        Ok(())
    }
}

/// Each call to the clock advances one second from a fixed start; ids count up.
pub struct FixedClock(AtomicI64);
impl Clock for FixedClock {
    fn now_ms(&self) -> i64 {
        self.0.fetch_add(1000, Ordering::SeqCst)
    }
}
pub struct CountingIds(AtomicU64);
impl Ids for CountingIds {
    fn new_id(&self) -> String {
        format!("id-{:06}", self.0.fetch_add(1, Ordering::SeqCst) + 1)
    }
}

pub struct FixedPlugin;
impl Plugin for FixedPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            r#"{"id":"std-fixed","version":"0.1.0","kind":"adapter","implements":[{"port":"clock"},{"port":"ids"}],"quality":"test"}"#,
        )
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        act.provide_clock(Arc::new(FixedClock(AtomicI64::new(1_700_000_000_000))));
        act.provide_ids(Arc::new(CountingIds(AtomicU64::new(0))));
        Ok(())
    }
}
