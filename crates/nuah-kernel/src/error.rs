//! The one error type that crosses the Link. Codes are stable and part of the contract.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

pub type Result<T> = std::result::Result<T, LinkError>;

impl LinkError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        LinkError { code: code.to_string(), message: message.into(), details: None }
    }
    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
    pub fn unauthenticated(message: &str) -> Self {
        Self::new("unauthenticated", message)
    }
    pub fn permission_denied(permission: &str) -> Self {
        Self::new("permission_denied", format!("missing permission `{permission}`"))
            .with_details(json!({ "missing": permission }))
    }
    pub fn not_found(what: &str) -> Self {
        Self::new("not_found", format!("{what} not found"))
    }
    pub fn invalid(field: &str, message: &str) -> Self {
        Self::new("invalid_input", format!("{field}: {message}"))
            .with_details(json!({ "field": field }))
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
    pub fn capability_denied(plugin: &str, capability: &str) -> Self {
        Self::new(
            "capability_denied",
            format!("plugin `{plugin}` did not declare capability `{capability}` in its manifest"),
        )
    }

    /// Status used by the HTTP projection. Other projections map codes their own way.
    pub fn http_status(&self) -> u16 {
        match self.code.as_str() {
            "unauthenticated" => 401,
            "permission_denied" => 403,
            "not_found" | "unknown_op" => 404,
            "invalid_input" => 400,
            "conflict" | "idempotency_conflict" | "request_in_progress" => 409,
            "quota_exceeded" => 429,
            _ => 500,
        }
    }
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LinkError {}
