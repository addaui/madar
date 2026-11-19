// SPDX-License-Identifier: Apache-2.0
//! `search`: one box that finds tasks, knowledge and pages across everything the caller can see. It asks the index of
//! entities (`@nuah/entities`, [ADR 0092]) and says each result in Madar's words: a task, a page of a project's
//! Knowledge, or one of your own pages, with its project and Space.
//!
//! [ADR 0092]: https://docs.addaui.com/nuah/adr/0092-one-index-of-entities-plugins-announce-them-in-their-events-the-data-port-searches-text-and-permissions-follow-the-events-audience/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// The Entity kind behind each of Madar's result kinds.
fn entity_kind(kind: &str) -> &'static str {
    if kind == "task" { "tasks.task" } else { "pages.page" }
}

pub struct Search;
impl Plugin for Search {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/search", "version": "0.2.0", "name": "Search", "namespaces": ["search"],
            "description": "One search over tasks, knowledge and pages: everything you can see, best match first",
            "requires": {"plugins": ["@nuah/entities", "@madar/projects"], "capabilities": ["call"]},
            "operations": {
                "search.query": {"kind": "query", "description": "Find tasks, knowledge and pages by words in their title or text, or pages by #tag",
                    "input": {"type":"object","required":["q"],"properties":{"q":{"type":"string","minLength":2,"maxLength":100},
                        "kinds":{"type":"array","items":{"enum":["task","knowledge","page"]},"maxItems":3},"space":{"type":"string","maxLength":60},"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false},
                    "output": crate::schemas::search_items()}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("search.query", |tx, i| {
            let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
            let kinds: Vec<String> = i.get("kinds").map(ids_of).unwrap_or_default();
            let q = text(&i, "q").trim().to_string();
            // `#name` asks for the pages that carry that tag, whole and in any case (ADR 0070)
            let mut ask = match q.strip_prefix('#').map(str::trim).filter(|t| !t.is_empty()) {
                Some(tag) => json!({"tag": tag, "kinds": ["pages.page"]}),
                None => json!({"q": q}),
            };
            ask["limit"] = json!(50);
            if !kinds.is_empty() && ask.get("tag").is_none() {
                let mut ek: Vec<&str> = kinds.iter().map(|k| entity_kind(k)).collect();
                ek.dedup();
                ask["kinds"] = json!(ek);
            }
            let found = tx.call("entities.search", ask)?;
            // a project's name, and the Space it was started in or moved to
            let projects: BTreeMap<String, (Value, String)> = tx.call("projects.list", json!({})).ok()
                .and_then(|w| w["projects"].as_array().cloned()).unwrap_or_default().iter()
                .map(|p| (text(p, "id").to_string(), (p["name"].clone(), p.get("space").and_then(|s| s.as_str()).unwrap_or("default").to_string()))).collect();
            let mut items = vec![];
            for x in found["items"].as_array().cloned().unwrap_or_default() {
                let c = &x["context"];
                let project = c["project"].as_str().map(String::from);
                let kind = match (text(&x, "kind"), &project) {
                    ("tasks.task", _) => "task",
                    (_, Some(_)) => "knowledge",
                    (_, None) => "page",
                };
                if !kinds.is_empty() && !kinds.iter().any(|k| k == kind) {
                    continue;
                }
                let place = project.as_ref().and_then(|p| projects.get(p));
                let space = match &project {
                    Some(_) => place.map(|(_, s)| s.clone()).unwrap_or_else(|| "default".into()),
                    None => c["space"].as_str().unwrap_or("default").to_string(),
                };
                if i.get("space").and_then(|s| s.as_str()).is_some_and(|want| want != space) {
                    continue;
                }
                let mut item = json!({"kind": kind, "id": x["id"], "title": x["title"], "snippet": x["snippet"], "score": x["score"], "tags": x["tags"],
                    "project": project, "project_name": place.map(|(n, _)| n.clone()).unwrap_or(Value::Null),
                    "space": if project.is_none() { json!(space) } else { Value::Null }});
                if kind == "task" {
                    item["done"] = c["done"].clone();
                }
                items.push(item);
            }
            items.truncate(limit);
            Ok(json!({"items": items}))
        });
    }
}
