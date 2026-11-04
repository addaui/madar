//! First-party adapters for the kernel's ports. Each one is a plugin with a manifest,
//! and each db adapter must pass `conformance::run_db_conformance`.

pub mod auth;
pub mod conformance;
pub mod memory;
pub mod policy;
pub mod sqlite;
pub mod std_ports;

pub use auth::{AuthLocalPlugin, AuthTokenPlugin};
pub use memory::MemoryDbPlugin;
pub use policy::{PolicyAllowPlugin, PolicyRolesPlugin};
pub use sqlite::SqliteDbPlugin;
pub use std_ports::{FixedPlugin, StdPlugin};
