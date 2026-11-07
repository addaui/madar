//! The fixed Ports: db, auth, policy, clock, ids. Each Port declares how many Adapters fill it (all five: one).

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

/// How many Adapters fill one Port ([ADR 0031]). Whether a Port may have several is a property of the
/// Port, not a choice of the Profile.
///
/// [ADR 0031]: https://docs.addaui.com/nuah/adr/0031-products-add-to-nuah-and-never-edit-it-ports-declare-cardinality-projections-are-plugins/
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cardinality {
    /// Exactly one Adapter; the Profile names it when several are enabled.
    Single,
    /// Every enabled Adapter is active. How a caller picks among them is that Port's own rule, decided
    /// when such a Port is proposed. No Port is `Many` yet, and the Resolver refuses to start one.
    Many,
}

#[derive(Debug, Clone, Copy)]
pub struct PortSpec {
    pub name: &'static str,
    pub cardinality: Cardinality,
}

pub const PORT_SPECS: [PortSpec; 5] = [
    PortSpec { name: "db", cardinality: Cardinality::Single },
    PortSpec { name: "auth", cardinality: Cardinality::Single },
    PortSpec { name: "policy", cardinality: Cardinality::Single },
    PortSpec { name: "clock", cardinality: Cardinality::Single },
    PortSpec { name: "ids", cardinality: Cardinality::Single },
];

pub const PORTS: [&str; 5] = ["db", "auth", "policy", "clock", "ids"];

/// How many Adapters fill this Port; `None` for a name that is not a Port.
pub fn cardinality(port: &str) -> Option<Cardinality> {
    PORT_SPECS.iter().find(|s| s.name == port).map(|s| s.cardinality)
}
