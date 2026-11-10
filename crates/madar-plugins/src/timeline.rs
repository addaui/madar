// SPDX-License-Identifier: Apache-2.0
//! `timeline`: one feed about an item (a task or a page), merged from whatever provides `timeline.source`.
//! ADR 0024. The Face decides how to draw it; the feed is newest first and loads a page at a time.

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub struct Timeline;
impl Plugin for Timeline {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/timeline", "version": "0.1.0", "name": "Timeline", "namespaces": ["timeline"],
            "description": "One feed about a task or page: comments, updates and (for owners) history, newest first",
            "requires": {"plugins": ["@madar/projects"], "capabilities": ["call"], "extension_points": ["timeline.source"]},
            "defines": {"extension_points": {"timeline.source": {"policy": "many",
                "description": "A plugin answers with its newest items about a target before a moment: {items: [{at, source, kind, id, actor, ..}]}",
                "input": {"type":"object","required":["project","target"]}}}},
            "operations": {
                "timeline.feed": {"kind": "query", "description": "The newest items about a task or page; pass `before` (the last `at` you have) for older ones",
                    "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","target"],"properties":{"project":{"type":"string"},
                        "target":{"type":"object","required":["type","id"],"properties":{"type":{"enum":["tasks.task","pages.page"]},"id":{"type":"string"}},"additionalProperties":false},
                        "before":{"type":"integer"},"limit":{"type":"integer","minimum":1,"maximum":100}},"additionalProperties":false},
                    "output": {"type":"object","required":["items"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("timeline.feed", |tx, i| {
            let project = text(&i, "project").to_string();
            let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(30) as usize;
            let manage = tx.call("projects.get", json!({"project": project}))?["can"].as_array().is_some_and(|c| c.iter().any(|x| x == "projects.manage"));
            let ask = json!({"project": project, "target": i["target"], "before": i.get("before").cloned().unwrap_or(Value::Null), "limit": limit + 1, "manage": manage});
            let mut items: Vec<Value> = vec![];
            for a in tx.extension_call("timeline.source", ask)?.as_array().cloned().unwrap_or_default() {
                if a["ok"] == true {
                    items.extend(a["output"]["items"].as_array().cloned().unwrap_or_default());
                }
            }
            items.sort_by(|a, b| b["at"].as_i64().cmp(&a["at"].as_i64()).then_with(|| text(b, "id").cmp(text(a, "id"))));
            let more = items.len() > limit;
            items.truncate(limit);
            let next = if more { items.last().map(|x| x["at"].clone()).unwrap_or(Value::Null) } else { Value::Null };
            Ok(json!({"items": items, "next": next}))
        });
    }
}
