//! The fixed Ports besides data: auth, policy, clock, ids. Exactly one Adapter fills each in a Core.

use crate::db::{DbRead, Millis};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Who is making a request, as verified by the auth Adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub subject: String,
    pub display: String,
    pub roles: Vec<String>,
}

impl Identity {
    pub fn new(subject: &str, display: &str, roles: &[&str]) -> Self {
        Identity { subject: subject.into(), display: display.into(), roles: roles.iter().map(|r| r.to_string()).collect() }
    }
    pub fn has_role(&self, r: &str) -> bool {
        self.roles.iter().any(|x| x == r)
    }
}

pub trait Auth: Send + Sync {
    fn name(&self) -> &str;
    /// Who does this credential belong to? `None` means nobody (unknown, expired). Sessions live in
    /// data the Adapter owns, so it reads through the handle it is given.
    fn authenticate(&self, db: &dyn DbRead, credential: &str, now: Millis) -> Result<Option<Identity>>;
    /// May an anonymous caller be treated as signed in without a credential (single-user setups)?
    fn implicit(&self) -> Option<Identity> {
        None
    }
}

/// What the Subject holds on the resource being acted on, as answered by the plugin that owns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    pub resource_type: String,
    pub resource_id: String,
    pub permissions: Vec<String>,
}

/// Permission -> Roles holding it by default, built from manifests and the Profile.
pub type PermissionTable = BTreeMap<String, Vec<String>>;

pub trait Policy: Send + Sync {
    fn name(&self) -> &str;
    /// May `who` use `permission`, given what they hold on the resource (if there is one)?
    fn allows(&self, who: &Identity, permission: &str, grant: Option<&Grant>, table: &PermissionTable) -> bool;
}

pub trait Clock: Send + Sync {
    fn now(&self) -> Millis;
}

pub trait Ids: Send + Sync {
    fn new_id(&self) -> String;
}

pub const PORTS: [&str; 5] = ["db", "auth", "policy", "clock", "ids"];
