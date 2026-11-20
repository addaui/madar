// SPDX-License-Identifier: Apache-2.0
//! The task element (ADR 0075, 0094): a task with details inside a page. Only these are the tasks Today shows from pages; a checklist is
//! not a task. An element plugin like any other: its kind is data (`browser/task-block/kinds.json`, with `task`, the attributes that hold
//! what Today shows), and its Browser module is embedded; both are written by `faces/elements`' build.

use crate::util::manifest;
use nuah_kernel::*;
use serde_json::{json, Value};

const FILES: &[(&str, &[u8])] = include!("../browser/task-block/files.rs");
const KINDS: &str = include_str!("../browser/task-block/kinds.json");

pub struct TaskBlock;
impl Plugin for TaskBlock {
    fn manifest(&self) -> Manifest {
        let kinds: Value = serde_json::from_str(KINDS).expect("kinds.json is JSON");
        manifest(json!({
            "id": "@madar/task-block", "version": "0.2.0", "name": "Task block", "namespaces": ["task-block"], "runtime": "data",
            "description": "A block that makes a task with details (done, due date, priority, notes) inside a page; these are the tasks Today shows from pages",
            "requires": {"extension_points": ["editor.element@^1"]},
            "provides": [{"extension_point": "editor.element", "data": kinds}],
            "browser": {"editor.element": "index.js"}
        }))
    }
    fn browser_files(&self) -> &'static [(&'static str, &'static [u8])] {
        FILES
    }
}
