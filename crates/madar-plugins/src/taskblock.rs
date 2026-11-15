// SPDX-License-Identifier: Apache-2.0
//! The task block (ADR 0075): a block that makes a task, with details, inside a page. Only these are the tasks Today shows from pages; a checklist is not a task.

use crate::content::{block, choice, date_opt, text_opt, with_options};
use crate::util::manifest;
use nuah_kernel::*;
use serde_json::json;

pub struct TaskBlock;
impl Plugin for TaskBlock {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/task-block", "version": "0.1.0", "name": "Task block", "namespaces": ["task-block"],
            "description": "A block that makes a task with details (done, due date, priority, notes) inside a page; these are the tasks Today shows from pages",
            "requires": {"plugins": ["@madar/editor"]},
            "provides": [{"extension_point": "editor.block"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("editor.block", |_tx, _i| {
            let mut task = with_options(block("taskBlock", "taskBlock", json!({}), "Task", "مهمة", "list", "task todo due priority deadline", "task"), vec![
                json!({"id": "checked", "type": "toggle", "label": {"en": "Done", "ar": "منجزة"}, "default": false}),
                date_opt("due", "Due date", "تاريخ الاستحقاق"),
                choice("priority", "Priority", "الأولوية", json!(null), vec![(json!("low"), "Low", "منخفضة"), (json!("medium"), "Medium", "متوسطة"), (json!("high"), "High", "عالية")], false),
                text_opt("details", "Notes", "ملاحظات"),
            ]);
            // which attributes hold the details Today shows (read by the pages plugin from the declaration)
            task["task"] = json!({"done": "checked", "due": "due", "priority": "priority", "notes": "details"});
            Ok(json!({"blocks": [task]}))
        });
    }
}
