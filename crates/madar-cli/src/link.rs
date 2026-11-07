//! The Link as the CLI sees it. Two Projections, one trait: a Core in this process (`--db`) or a
//! server over HTTP. The commands above it do not know which one they got.

use nuah_kernel::{CallRequest, Core, Error, Identity};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};

pub trait Link {
    fn describe(&self) -> Result<Value, Error>;
    fn call(&self, op: &str, input: Value, key: Option<&str>) -> Result<Value, Error>;
    /// Follow Pulse, handing each event to `each` until it returns false or the stream ends.
    fn watch(&self, each: &mut dyn FnMut(&str, &Value) -> bool) -> Result<(), Error>;
}

pub struct InProcess {
    pub core: Core,
}

impl InProcess {
    /// One person, one file: the embedded profile signs everyone in as its single account.
    fn who(&self) -> Result<Identity, Error> {
        self.core.authenticate(None)
    }
}

impl Link for InProcess {
    fn describe(&self) -> Result<Value, Error> {
        Ok(self.core.describe(&self.who()?))
    }
    fn call(&self, op: &str, input: Value, key: Option<&str>) -> Result<Value, Error> {
        let r = self.core.call(CallRequest { credential: None, op: op.into(), input, key: key.map(String::from), contract: None })?;
        let _ = self.core.drain_listeners();
        Ok(r.output)
    }
    fn watch(&self, each: &mut dyn FnMut(&str, &Value) -> bool) -> Result<(), Error> {
        let who = self.who()?;
        let mut cursor = self.core.pulse_now()?;
        loop {
            let b = self.core.pulse(&who, Some(&cursor), 200)?;
            for e in &b.events {
                if !each(&e.kind, &serde_json::to_value(e).unwrap_or_default()) {
                    return Ok(());
                }
            }
            cursor = b.cursor;
            if !b.more {
                // another process may write the same file, so poll
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
        }
    }
}

pub struct Http {
    pub base: String,
    pub token: Option<String>,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).build().into()
}

fn bad(msg: impl Into<String>) -> Error {
    Error::internal(msg)
}

impl Http {
    fn auth(&self) -> Option<String> {
        self.token.as_ref().map(|t| format!("Bearer {t}"))
    }
}

impl Link for Http {
    fn describe(&self) -> Result<Value, Error> {
        let mut req = agent().get(&format!("{}/link/describe", self.base));
        if let Some(a) = self.auth() {
            req = req.header("Authorization", &a);
        }
        let mut res = req.call().map_err(|e| bad(format!("cannot reach {}: {e}", self.base)))?;
        res.body_mut().read_json().map_err(|e| bad(format!("the server did not answer with JSON: {e}")))
    }
    fn call(&self, op: &str, input: Value, key: Option<&str>) -> Result<Value, Error> {
        let mut req = agent().post(&format!("{}/link/call/{op}", self.base)).header("Content-Type", "application/json").header("X-Nuah-Face", "cli");
        if let Some(a) = self.auth() {
            req = req.header("Authorization", &a);
        }
        if let Some(k) = key {
            req = req.header("Idempotency-Key", k);
        }
        let mut res = req.send(input.to_string()).map_err(|e| bad(format!("cannot reach {}: {e}", self.base)))?;
        let body: Value = res.body_mut().read_json().map_err(|e| bad(format!("the server did not answer with JSON: {e}")))?;
        if body["ok"] == json!(true) {
            Ok(body["output"].clone())
        } else {
            Err(serde_json::from_value(body["error"].clone()).unwrap_or_else(|_| bad("the server refused without saying why")))
        }
    }
    fn watch(&self, each: &mut dyn FnMut(&str, &Value) -> bool) -> Result<(), Error> {
        let mut req = agent().get(&format!("{}/pulse", self.base));
        if let Some(a) = self.auth() {
            req = req.header("Authorization", &a);
        }
        let res = req.call().map_err(|e| bad(format!("cannot reach {}: {e}", self.base)))?;
        if res.status().as_u16() != 200 {
            return Err(Error::unauthenticated());
        }
        let (mut event, mut data) = (String::new(), String::new());
        for line in BufReader::new(res.into_body().into_reader()).lines() {
            let line = line.map_err(|e| bad(format!("the stream broke: {e}")))?;
            if let Some(v) = line.strip_prefix("event:") {
                event = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("data:") {
                data = v.trim().to_string();
            } else if line.is_empty() && !event.is_empty() {
                let v: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
                if !each(&event, &v) {
                    return Ok(());
                }
                event.clear();
                data.clear();
            }
        }
        Ok(())
    }
}
