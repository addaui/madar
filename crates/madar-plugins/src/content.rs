// SPDX-License-Identifier: Apache-2.0
//! Rich text, the editor's block registry, and references between items.
//! Design: ADR 0019 (references), ADR 0020 (rich text), https://docs.addaui.com/nuah/plans/madar-v3-plan/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

// ---- rich text ---------------------------------------------------------------------------------------

/// Rich text is a JSON tree `{type: "doc", content: [..]}` (ADR 0020). The server only checks its shape,
/// so content survives a plugin being switched off.
pub mod richtext {
    use super::*;

    pub const MAX_DEPTH: usize = 24;
    pub const MAX_NODES: usize = 20_000;
    pub const MAX_TEXT: usize = 200_000;

    pub fn empty() -> Value {
        json!({"type": "doc", "content": [{"type": "paragraph"}]})
    }

    fn word(s: &str) -> bool {
        !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    }

    /// Is this a well-formed document of a reasonable size?
    pub fn check(field: &str, v: &Value) -> Result<()> {
        if v["type"] != "doc" {
            return Err(Error::invalid(field, "must be a document: {\"type\":\"doc\",\"content\":[..]}"));
        }
        stickers_ok(field, &v["attrs"]["stickers"])?;
        let (mut nodes, mut text) = (0usize, 0usize);
        walk(field, v, 0, &mut nodes, &mut text)
    }

    pub const MAX_STICKERS: usize = 200;

    /// The stickers on a page (ADR 0071) live in the document's attributes: a list of small objects. Each is checked so a saved page cannot
    /// carry an absurd position or size, or a source that is not an emoji or one of our own files.
    fn stickers_ok(field: &str, v: &Value) -> Result<()> {
        if v.is_null() {
            return Ok(());
        }
        let bad = |why: &str| Err(Error::invalid(field, why));
        let Some(list) = v.as_array() else { return bad("has stickers that are not a list") };
        if list.len() > MAX_STICKERS {
            return bad("has too many stickers");
        }
        let num = |s: &Value, k: &str, lo: f64, hi: f64| s[k].as_f64().is_some_and(|x| x.is_finite() && x >= lo && x <= hi);
        let mut ids = std::collections::HashSet::new();
        for s in list {
            let id_ok = s["id"].as_str().is_some_and(|i| word(i) && ids.insert(i.to_string()));
            let src_ok = match s["kind"].as_str() {
                Some("emoji") => s["value"].as_str().is_some_and(|e| !e.is_empty() && e.chars().count() <= 16),
                Some("image") => s["value"].as_str().is_some_and(|u| file_id(u).is_some()),
                Some("pack") => s["value"].as_str().is_some_and(word),
                // A GIF kept as its provider's own address (ADR 0072); what may load is decided by the browser's policy.
                Some("gif") => s["value"].as_str().is_some_and(|u| u.len() <= 500 && u.starts_with("https://") && !u.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '<')),
                _ => false,
            };
            let anchor_ok = s["anchor"].is_null() || s["anchor"].as_str().is_some_and(word);
            let wrap_ok = s["wrap"].is_null() || matches!(s["wrap"].as_str(), Some("none" | "contour" | "oval" | "rect"));
            let at_ok = s["at"].is_null() || s["at"].as_u64().is_some_and(|a| a <= 200_000);
            let sizes_ok = s["sizes"].is_null()
                || s["sizes"].as_object().is_some_and(|o| {
                    o.iter().all(|(k, v)| {
                        matches!(k.as_str(), "narrow" | "medium")
                            && v.as_object().is_some_and(|f| f.iter().all(|(n, x)| match n.as_str() {
                                "x" => num(v, "x", -2.0, 3.0),
                                "y" => num(v, "y", -2000.0, 2000.0),
                                "w" => num(v, "w", 0.01, 4.0),
                                "rot" => num(v, "rot", -360.0, 360.0),
                                "flip" | "hidden" => x.is_boolean(),
                                "anchor" => x.is_null() || x.as_str().is_some_and(word),
                                "at" => x.is_null() || x.as_u64().is_some_and(|a| a <= 200_000),
                                _ => false,
                            }))
                    })
                });
            let wm_ok = s["wm"].is_null() || num(s, "wm", 0.0, 5.0);
            let z_ok = s["z"].as_str().is_some_and(|z| !z.is_empty() && z.len() <= 40 && z.chars().all(|c| c.is_ascii_alphanumeric()));
            if !(id_ok && src_ok && anchor_ok && wrap_ok && at_ok && sizes_ok && wm_ok && z_ok && num(s, "x", -2.0, 3.0) && num(s, "y", -2000.0, 2000.0) && num(s, "w", 0.01, 4.0) && num(s, "rot", -360.0, 360.0)) {
                return bad("has a sticker that is not valid");
            }
        }
        Ok(())
    }

    fn walk(field: &str, n: &Value, depth: usize, nodes: &mut usize, text: &mut usize) -> Result<()> {
        let bad = |why: &str| Err(Error::invalid(field, why));
        if depth > MAX_DEPTH {
            return bad("is nested too deeply");
        }
        *nodes += 1;
        if *nodes > MAX_NODES {
            return bad("has too many blocks");
        }
        let Some(o) = n.as_object() else { return bad("holds something that is not a node") };
        if !o.get("type").and_then(|t| t.as_str()).is_some_and(word) {
            return bad("has a node without a valid type");
        }
        if let Some(a) = o.get("attrs") {
            if !a.is_object() {
                return bad("has attrs that are not an object");
            }
        }
        if let Some(t) = o.get("text") {
            let Some(s) = t.as_str() else { return bad("has text that is not a string") };
            *text += s.len();
            if *text > MAX_TEXT {
                return bad("has too much text");
            }
        }
        if let Some(m) = o.get("marks") {
            let ok = m.as_array().is_some_and(|a| a.len() <= 20 && a.iter().all(|x| x["type"].as_str().is_some_and(word)));
            if !ok {
                return bad("has invalid marks");
            }
        }
        if let Some(c) = o.get("content") {
            let Some(kids) = c.as_array() else { return bad("has content that is not a list") };
            for k in kids {
                walk(field, k, depth + 1, nodes, text)?;
            }
        }
        Ok(())
    }

    /// The text of a document, blocks separated by newlines (for search and previews).
    pub fn text_of(v: &Value) -> String {
        fn go(n: &Value, out: &mut String) {
            if let Some(t) = n["text"].as_str() {
                out.push_str(t);
            }
            // an element says what it is in its Fallback (ADR 0094)
            if n["type"] == "element" || n["type"] == "elementInline" {
                if let Some(t) = n["attrs"]["fallback"]["text"].as_str() {
                    out.push_str(t);
                }
                if n["type"] == "element" && !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            if let Some(kids) = n["content"].as_array() {
                let block = n["type"] != "text" && n["type"] != "doc";
                for k in kids {
                    go(k, out);
                }
                if block && !out.ends_with('\n') {
                    out.push('\n');
                }
            }
        }
        let mut s = String::new();
        go(v, &mut s);
        s.trim().to_string()
    }

    /// Every item the document refers to, as `(kind, id)`, once each. A reference is a node
    /// `{"type": "entityRef", "attrs": {"kind": "pages.page", "id": ".."}}`.
    pub fn refs_of(v: &Value) -> Vec<(String, String)> {
        fn go(n: &Value, out: &mut Vec<(String, String)>) {
            if n["type"] == "entityRef" {
                let (k, i) = (n["attrs"]["kind"].as_str().unwrap_or(""), n["attrs"]["id"].as_str().unwrap_or(""));
                if !k.is_empty() && !i.is_empty() && !out.iter().any(|(a, b)| a == k && b == i) {
                    out.push((k.to_string(), i.to_string()));
                }
            }
            // An image or file block that shows an uploaded file refers to it (ADR 0026).
            if let Some(id) = n["attrs"]["src"].as_str().or_else(|| n["attrs"]["url"].as_str()).and_then(file_id) {
                let k = "files.file";
                if !out.iter().any(|(a, b)| a == k && b == id) {
                    out.push((k.to_string(), id.to_string()));
                }
            }
            for k in n["content"].as_array().into_iter().flatten() {
                go(k, out);
            }
        }
        let mut out = vec![];
        go(v, &mut out);
        // A sticker made from an uploaded picture keeps its file alive too (ADR 0071).
        for st in v["attrs"]["stickers"].as_array().into_iter().flatten() {
            if let Some(id) = st["value"].as_str().and_then(file_id) {
                if !out.iter().any(|(a, b)| a == "files.file" && b == id) {
                    out.push(("files.file".to_string(), id.to_string()));
                }
            }
        }
        out
    }

    /// The id in an address of an uploaded file (`/files/<id>`), when it is one.
    pub fn file_id(url: &str) -> Option<&str> {
        let id = url.strip_prefix("/files/")?;
        (!id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(id)
    }

    /// The uploaded files a document shows.
    pub fn files_of(v: &Value) -> Vec<String> {
        refs_of(v).into_iter().filter(|(k, _)| k == "files.file").map(|(_, i)| i).collect()
    }

    /// The `refs` part of an event's data: what `from` now refers to (ADR 0019).
    pub fn refs_for(kind: &str, id: &str, title: &str, doc: &Value) -> Value {
        json!({"from": {"type": kind, "id": id}, "title": title,
               "to": refs_of(doc).into_iter().map(|(k, i)| json!({"type": k, "id": i})).collect::<Vec<_>>()})
    }
}

// ---- editor: the registry of blocks ----------------------------------------------------------------------

/// What refers to an item. The index of entities (`@nuah/entities`) keeps the links from the `refs` that pages, tasks
/// and discussion put in their Events, and answers only with links from what the caller can see.
pub struct Refs;
impl Plugin for Refs {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/refs", "version": "0.2.0", "name": "References", "namespaces": ["refs"],
            "description": "Shows what refers to an item, from everything you can see",
            "requires": {"plugins": ["@madar/projects", "@nuah/entities"], "capabilities": ["call"]},
            "operations": {
                "refs.to": {"kind": "query", "description": "What refers to an item of a project, from everything you can see", "permission": "projects.read",
                    "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","kind","id"],"properties":{"project":{"type":"string"},"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}},
                "refs.mine": {"kind": "query", "description": "What refers to one of your own pages, from everything you can see",
                    "input": {"type":"object","required":["kind","id"],"properties":{"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        fn backlinks(tx: &mut Tx, i: &Value) -> Result<Value> {
            let found = tx.call("entities.backlinks", json!({"kind": text(i, "kind"), "id": text(i, "id")}))?;
            Ok(json!({"links": found["links"]}))
        }
        b.op("refs.to", |tx, i| backlinks(tx, &i));
        b.op("refs.mine", |tx, i| backlinks(tx, &i));
    }
}

#[cfg(test)]
mod tests {
    use super::richtext::*;
    use serde_json::json;

    #[test]
    fn documents_are_checked_for_shape_and_size() {
        assert!(check("body", &empty()).is_ok());
        assert!(check("body", &json!({"type": "paragraph"})).is_err());
        assert!(check("body", &json!({"type": "doc", "content": [{"type": "Not valid!"}]})).is_err());
        assert!(check("body", &json!({"type": "doc", "content": [{"type": "x", "text": 5}]})).is_err());
        let mut deep = json!({"type": "x"});
        for _ in 0..30 {
            deep = json!({"type": "x", "content": [deep]});
        }
        assert!(check("body", &json!({"type": "doc", "content": [deep]})).is_err());
        // a block this server has never heard of is fine
        assert!(check("body", &json!({"type": "doc", "content": [{"type": "plugin.chart", "attrs": {"a": 1}}]})).is_ok());
    }

    #[test]
    fn a_block_may_carry_a_stable_id_and_the_document_keeps_it() {
        // ADR 0043: the editor gives every block an id; the server stores the document as it is
        let doc = json!({"type": "doc", "content": [{"type": "paragraph", "attrs": {"blockId": "b1x"}, "content": [{"type": "text", "text": "a"}]}]});
        assert!(check("body", &doc).is_ok());
    }

    #[test]
    fn text_and_references_come_out_of_a_document() {
        let doc = json!({"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Plan"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "see "}, {"type": "entityRef", "attrs": {"kind": "pages.page", "id": "p1"}},
                {"type": "entityRef", "attrs": {"kind": "pages.page", "id": "p1"}}, {"type": "entityRef", "attrs": {"kind": "tasks.task", "id": "t9"}}]}]});
        assert_eq!(text_of(&doc), "Plan\nsee");
        assert_eq!(refs_of(&doc), vec![("pages.page".to_string(), "p1".to_string()), ("tasks.task".to_string(), "t9".to_string())]);
    }
}
