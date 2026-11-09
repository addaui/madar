// SPDX-License-Identifier: Apache-2.0
//! `search`: one box that finds tasks, knowledge and pages across everything the caller can see.
//! Whoever holds something searchable answers the Extension point `search.source`. ADR 0025.

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

/// How well `title` and `body` match every word of `q` (all must appear), and a short piece of the body around the first hit.
/// `None` if a word is missing. A hit in the title counts three times a hit in the body.
pub fn score(q: &str, title: &str, body: &str) -> Option<(f64, String)> {
    let words: Vec<String> = q.split_whitespace().map(|w| w.to_lowercase()).collect();
    if words.is_empty() {
        return None;
    }
    let (t, b) = (title.to_lowercase(), body.to_lowercase());
    let mut s = 0.0;
    for w in &words {
        let (in_t, in_b) = (t.matches(w.as_str()).count(), b.matches(w.as_str()).count());
        if in_t + in_b == 0 {
            return None;
        }
        s += in_t as f64 * 3.0 + (in_b as f64).min(5.0);
        if t.starts_with(w.as_str()) {
            s += 2.0;
        }
    }
    // work in characters so we never cut a letter in half
    let chars: Vec<char> = body.chars().collect();
    let low: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
    let at = words.iter().find_map(|w| {
        let w: Vec<char> = w.chars().collect();
        low.windows(w.len()).position(|x| x == w.as_slice())
    });
    let snippet = at.map(|at| {
        let from = at.saturating_sub(40);
        chars[from..(from + 140).min(chars.len())].iter().collect::<String>().replace('\n', " ")
    }).unwrap_or_default();
    Some((s, snippet))
}

pub struct Search;
impl Plugin for Search {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "search", "version": "0.1.0", "name": "Search", "namespaces": ["search"],
            "description": "One search over tasks, knowledge and pages: everything you can see, best match first",
            "requires": {"capabilities": ["call"], "extension_points": ["search.source"]},
            "defines": {"extension_points": {"search.source": {"policy": "many",
                "description": "A plugin answers with the things it holds that match {q}: {items: [{kind, id, title, snippet, score, project?, project_name?}]}. It only returns what the caller may see.",
                "input": {"type":"object","required":["q"]}}}},
            "operations": {
                "search.query": {"kind": "query", "description": "Find tasks, knowledge and pages by words in their title or text",
                    "input": {"type":"object","required":["q"],"properties":{"q":{"type":"string","minLength":2,"maxLength":100},
                        "kinds":{"type":"array","items":{"enum":["task","knowledge","page"]},"maxItems":3},"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false},
                    "output": {"type":"object","required":["items"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("search.query", |tx, i| {
            let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
            let kinds: Vec<String> = i.get("kinds").map(ids_of).unwrap_or_default();
            let mut items: Vec<Value> = vec![];
            for a in tx.extension_call("search.source", json!({"q": text(&i, "q")}))?.as_array().cloned().unwrap_or_default() {
                if a["ok"] == true {
                    items.extend(a["output"]["items"].as_array().cloned().unwrap_or_default());
                }
            }
            items.retain(|x| kinds.is_empty() || kinds.iter().any(|k| k == text(x, "kind")));
            items.sort_by(|a, b| b["score"].as_f64().partial_cmp(&a["score"].as_f64()).unwrap_or(std::cmp::Ordering::Equal).then_with(|| text(a, "title").cmp(text(b, "title"))));
            items.truncate(limit);
            Ok(json!({"items": items}))
        });
    }
}
