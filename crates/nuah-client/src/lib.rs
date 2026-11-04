//! The face side of the Link. A face is written against the `Link` trait and cannot tell whether
//! the core is inside the same process (coupled) or across a network (decoupled).

use nuah_kernel::*;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::time::Duration;

pub trait Link: Send + Sync {
    /// Run an operation. A stable idempotency key makes retries of a command safe.
    fn call(&self, op: &str, input: Value, idempotency_key: Option<&str>) -> Result<Value>;
    /// The core's self-description: contract, ops, permissions for this caller, slots, themes.
    fn describe(&self) -> Result<Value>;
    /// Pulse. Replays everything after `after`, then streams live events. Blocks until `on_event`
    /// returns false or the stream ends. Pass the last seq you saw to resume without gaps.
    fn watch(&self, after: u64, on_event: &mut dyn FnMut(Event) -> bool) -> Result<()>;
    /// "in-process" or the base URL, for display.
    fn endpoint(&self) -> String;
}

// ---------- coupled: the core lives in this process ----------

pub struct InProcess {
    core: Core,
    credential: Option<String>,
    face: String,
}

impl InProcess {
    pub fn new(core: Core, credential: Option<String>, face: &str) -> Self {
        InProcess { core, credential, face: face.to_string() }
    }
}

impl Link for InProcess {
    fn call(&self, op: &str, input: Value, key: Option<&str>) -> Result<Value> {
        self.core
            .call(CallRequest {
                credential: self.credential.clone(),
                op: op.into(),
                input,
                idempotency_key: key.map(String::from),
                face: Some(self.face.clone()),
            })
            .map(|r| r.data)
    }
    fn describe(&self) -> Result<Value> {
        Ok(self.core.describe(self.credential.as_deref(), Some(&self.face)))
    }
    /// Polls the shared log instead of listening to an in-process channel, so that a watcher also
    /// sees changes made by another process that uses the same database file.
    fn watch(&self, after: u64, on_event: &mut dyn FnMut(Event) -> bool) -> Result<()> {
        let who = self.core.authenticate(self.credential.as_deref())?;
        let mut last = after;
        loop {
            let batch = self.core.events_since(&who.subject, last, 500)?;
            let full = batch.len() == 500;
            for e in batch {
                last = e.seq;
                if !on_event(e) {
                    return Ok(());
                }
            }
            if !full {
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
    fn endpoint(&self) -> String {
        "in-process".into()
    }
}

// ---------- decoupled: the core is somewhere else ----------

pub struct Http {
    base: String,
    token: Option<String>,
    face: String,
    agent: ureq::Agent,
    stream_agent: ureq::Agent,
}

fn transport(e: impl std::fmt::Display) -> LinkError {
    LinkError::new("transport", e.to_string())
}

impl Http {
    pub fn new(base: &str, token: Option<String>, face: &str) -> Self {
        let build = |timeout: Option<Duration>| -> ureq::Agent {
            ureq::Agent::config_builder().http_status_as_error(false).timeout_global(timeout).build().into()
        };
        Http {
            base: base.trim_end_matches('/').to_string(),
            token,
            face: face.to_string(),
            agent: build(Some(Duration::from_secs(30))),
            stream_agent: build(None),
        }
    }
}

fn read_error(body: &mut ureq::Body, status: u16) -> LinkError {
    match body.read_json::<Value>() {
        Ok(v) => match serde_json::from_value::<LinkError>(v["error"].clone()) {
            Ok(e) => e,
            Err(_) => LinkError::new("transport", format!("unexpected response (HTTP {status})")),
        },
        Err(_) => LinkError::new("transport", format!("unexpected response (HTTP {status})")),
    }
}

impl Link for Http {
    fn call(&self, op: &str, input: Value, key: Option<&str>) -> Result<Value> {
        // A retry with the same idempotency key is safe: the core answers a repeat with the first result.
        let attempts = if key.is_some() { 3 } else { 1 };
        let mut last_err = LinkError::new("transport", "no attempt made");
        for attempt in 0..attempts {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(200 * attempt as u64));
            }
            let mut r = self.agent.post(&format!("{}/link/call/{op}", self.base)).header("X-Nuah-Face", &self.face);
            if let Some(t) = &self.token {
                r = r.header("Authorization", &format!("Bearer {t}"));
            }
            if let Some(k) = key {
                r = r.header("Idempotency-Key", k);
            }
            match r.send_json(&input) {
                Ok(mut resp) => {
                    let status = resp.status().as_u16();
                    if status >= 400 {
                        return Err(read_error(resp.body_mut(), status));
                    }
                    let v: Value = resp.body_mut().read_json().map_err(transport)?;
                    return Ok(v["data"].clone());
                }
                Err(e) => last_err = transport(e),
            }
        }
        Err(last_err)
    }

    fn describe(&self) -> Result<Value> {
        let mut req = self.agent.get(&format!("{}/link/describe?face={}", self.base, self.face));
        if let Some(t) = &self.token {
            req = req.header("Authorization", &format!("Bearer {t}"));
        }
        let mut resp = req.call().map_err(transport)?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(read_error(resp.body_mut(), status));
        }
        resp.body_mut().read_json().map_err(transport)
    }

    fn watch(&self, after: u64, on_event: &mut dyn FnMut(Event) -> bool) -> Result<()> {
        let mut req = self
            .stream_agent
            .get(&format!("{}/pulse?after={after}", self.base))
            .header("Accept", "text/event-stream");
        if let Some(t) = &self.token {
            req = req.header("Authorization", &format!("Bearer {t}"));
        }
        let mut resp = req.call().map_err(transport)?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(read_error(resp.body_mut(), status));
        }
        let reader = BufReader::new(resp.into_body().into_reader());
        let mut data = String::new();
        let mut kind = String::new();
        for line in reader.lines() {
            let line = line.map_err(transport)?;
            if let Some(d) = line.strip_prefix("data:") {
                data.push_str(d.trim_start());
            } else if let Some(k) = line.strip_prefix("event:") {
                kind = k.trim().to_string();
            } else if line.is_empty() {
                if !data.is_empty() && kind != "ready" {
                    if let Ok(e) = serde_json::from_str::<Event>(&data) {
                        if !on_event(e) {
                            return Ok(());
                        }
                    }
                }
                data.clear();
                kind.clear();
            }
        }
        Ok(())
    }

    fn endpoint(&self) -> String {
        self.base.clone()
    }
}

/// Helper for faces: build the right link from settings, so the rest of the face never branches.
pub fn connect(remote: Option<&str>, token: Option<String>, core: impl FnOnce() -> std::result::Result<Core, String>, face: &str) -> std::result::Result<Arc<dyn Link>, String> {
    match remote {
        Some(url) => Ok(Arc::new(Http::new(url, token, face))),
        None => Ok(Arc::new(InProcess::new(core()?, token, face))),
    }
}
