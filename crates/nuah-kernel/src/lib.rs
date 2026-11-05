//! nuah-kernel: scope-owned registrations, ports, hooks, events, and the call pipeline.
//! Nothing here knows what a task is.

pub mod contract;
pub mod core;
pub mod error;
pub mod events;
pub mod manifest;
pub mod plugin;
pub mod ports;
pub mod schema;

pub use crate::core::{CallRequest, CallResponse, Core, Distribution, CONTRACT_VERSION};
pub use error::{LinkError, Result};
pub use events::Event;
pub use manifest::Manifest;
pub use plugin::*;
pub use ports::*;

/// A plugin with no code: it only contributes manifest data (for example a theme).
pub struct DataPlugin(pub Manifest);

impl Plugin for DataPlugin {
    fn manifest(&self) -> Manifest {
        self.0.clone()
    }
    fn activate(&self, _act: &mut Activation) -> Result<()> {
        Ok(())
    }
}
