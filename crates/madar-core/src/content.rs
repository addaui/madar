// SPDX-License-Identifier: Apache-2.0
//! Rich text, the editor's block registry, and references between items.
//! Design: ADR 0019 (references), ADR 0020 (rich text), https://docs.addaui.com/nuah/plans/madar-v3-plan/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

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
        let (mut nodes, mut text) = (0usize, 0usize);
        walk(field, v, 0, &mut nodes, &mut text)
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

pub struct Editor;
impl Plugin for Editor {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "editor", "version": "0.1.0", "name": "Editor", "namespaces": ["editor"],
            "description": "Which blocks the rich-text editor offers; other plugins add blocks (editor.block)",
            "requires": {"extension_points": ["editor.block"]},
            "defines": {"extension_points": {"editor.block": {"policy": "many",
                "description": "A plugin answers with the blocks it adds: {blocks: [{id, node, attrs?, label, group, keywords}]}",
                "input": {"type":"object"}}}},
            "operations": {
                "editor.blocks": {"kind": "query", "description": "The blocks the editor offers, for the slash menu",
                    "output": {"type":"object","required":["blocks"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("editor.blocks", |tx, _| {
            let answers = tx.extension_call("editor.block", json!({}))?;
            let mut blocks: Vec<Value> = vec![];
            for a in answers.as_array().cloned().unwrap_or_default() {
                if a["ok"] == true {
                    for blk in a["output"]["blocks"].as_array().cloned().unwrap_or_default() {
                        let id = blk["id"].as_str().unwrap_or("").to_string();
                        if !id.is_empty() && !blocks.iter().any(|x| x["id"] == id.as_str()) {
                            let mut blk = blk;
                            blk["plugin"] = a["provider"].clone();
                            blocks.push(blk);
                        }
                    }
                }
            }
            Ok(json!({"blocks": blocks}))
        });
    }
}

fn block(id: &str, node: &str, attrs: Value, en: &str, ar: &str, group: &str, keywords: &str) -> Value {
    json!({"id": id, "node": node, "attrs": attrs, "label": {"en": en, "ar": ar}, "group": group, "keywords": keywords})
}

pub struct EditorBasic;
impl Plugin for EditorBasic {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "editor-basic", "version": "0.1.0", "name": "Basic blocks", "namespaces": ["editor-basic"],
            "description": "Headings, lists, quote, code, checklist, toggle, callouts, image, file, embeds and references",
            "requires": {"plugins": ["editor"]},
            "provides": [{"extension_point": "editor.block"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("editor.block", |_tx, _i| {
            Ok(json!({"blocks": [
                block("heading1", "heading", json!({"level": 1}), "Heading 1", "عنوان ١", "text", "title h1"),
                block("heading2", "heading", json!({"level": 2}), "Heading 2", "عنوان ٢", "text", "subtitle h2"),
                block("heading3", "heading", json!({"level": 3}), "Heading 3", "عنوان ٣", "text", "h3"),
                block("blockquote", "blockquote", json!({}), "Quote", "اقتباس", "text", "blockquote cite"),
                block("divider", "horizontalRule", json!({}), "Divider", "فاصل", "text", "line hr separator"),
                block("codeBlock", "codeBlock", json!({}), "Code block", "كتلة شيفرة", "text", "code snippet"),
                block("bulletList", "bulletList", json!({}), "Bullet list", "قائمة نقطية", "list", "ul unordered"),
                block("orderedList", "orderedList", json!({}), "Numbered list", "قائمة مرقمة", "list", "ol ordered"),
                block("taskList", "taskList", json!({}), "Checklist", "قائمة مهام", "list", "todo check task"),
                block("toggle", "toggle", json!({}), "Toggle", "قسم قابل للطي", "layout", "collapse fold details"),
                block("calloutInfo", "callout", json!({"tone": "info"}), "Callout: info", "تنبيه: معلومة", "layout", "note"),
                block("calloutTip", "callout", json!({"tone": "tip"}), "Callout: tip", "تنبيه: نصيحة", "layout", "hint"),
                block("calloutWarning", "callout", json!({"tone": "warning"}), "Callout: warning", "تنبيه: تحذير", "layout", "caution"),
                block("calloutDanger", "callout", json!({"tone": "danger"}), "Callout: danger", "تنبيه: خطر", "layout", "error"),
                block("image", "image", json!({}), "Image", "صورة", "media", "picture photo"),
                block("file", "fileAttachment", json!({}), "File", "ملف", "media", "attachment upload"),
                block("youtube", "youtube", json!({}), "YouTube", "يوتيوب", "embed", "video"),
                block("linkPreview", "linkPreview", json!({}), "Link preview", "معاينة رابط", "embed", "url bookmark"),
                block("entityRef", "entityRef", json!({}), "Link to a page or task", "رابط إلى صفحة أو مهمة", "reference", "mention reference link")
            ]}))
        });
    }
}

// ---- references (ADR 0019) ----------------------------------------------------------------------------------

pub const LINKS: &str = "refs.refs";

fn key(kind: &str, id: &str) -> String {
    format!("{kind}:{id}")
}

pub struct Refs;
impl Plugin for Refs {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "refs", "version": "0.1.0", "name": "References", "namespaces": ["refs"],
            "description": "Remembers what refers to what, so every item can show what refers to it",
            "requires": {"plugins": ["projects"]},
            "data": {"collections": [LINKS], "version": 1,
                     "indexes": [{"collection": LINKS, "field": "from_key"}, {"collection": LINKS, "field": "to_key"}]},
            "operations": {
                "refs.to": {"kind": "query", "description": "What refers to an item, inside one project", "permission": "projects.read",
                    "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","kind","id"],"properties":{"project":{"type":"string"},"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}},
                "refs.mine": {"kind": "query", "description": "What refers to one of your own notes",
                    "input": {"type":"object","required":["kind","id"],"properties":{"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}}
            },
            "listeners": [{"id": "refs.record", "on": ["pages.*", "notes.*", "tasks.*", "discussion.*"], "handler": "refs.record"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        // Safe to repeat: the row ids come from the two ends, so a second delivery overwrites itself.
        b.listener("refs.record", |tx, d| {
            let l = &d.event.data["refs"];
            let (kind, id) = (text(&l["from"], "type"), text(&l["from"], "id"));
            if l.is_null() || kind.is_empty() || id.is_empty() {
                return Ok(());
            }
            let from_key = key(kind, id);
            loop {
                let old = tx.query(LINKS, &Query::new().eq("from_key", from_key.as_str()).limit(200))?;
                if old.items.is_empty() {
                    break;
                }
                for o in old.items {
                    tx.delete(LINKS, &o.id)?;
                }
            }
            let owner = if d.event.data["project"].is_null() { d.actor.clone() } else { String::new() };
            for t in l["to"].as_array().cloned().unwrap_or_default() {
                let to_key = key(text(&t, "type"), text(&t, "id"));
                let rid = format!("{:x}", Sha256::digest(format!("{from_key}>{to_key}").as_bytes()));
                tx.put(LINKS, &rid[..32], json!({
                    "from": l["from"], "to": t, "from_key": from_key, "to_key": to_key, "title": l["title"],
                    "project": d.event.data["project"], "owner": owner
                }), Expect::Any)?;
            }
            Ok(())
        });
        b.op("refs.to", |tx, i| {
            let to_key = key(text(&i, "kind"), text(&i, "id"));
            let page = tx.query(LINKS, &Query::new().eq("to_key", to_key.as_str()).eq("project", text(&i, "project")).limit(200))?;
            Ok(json!({"links": page.items.iter().map(|d| json!({"from": d.body["from"], "title": d.body["title"]})).collect::<Vec<_>>()}))
        });
        b.op("refs.mine", |tx, i| {
            let to_key = key(text(&i, "kind"), text(&i, "id"));
            let me = tx.who().subject.clone();
            let page = tx.query(LINKS, &Query::new().eq("to_key", to_key.as_str()).eq("owner", me.as_str()).limit(200))?;
            Ok(json!({"links": page.items.iter().map(|d| json!({"from": d.body["from"], "title": d.body["title"]})).collect::<Vec<_>>()}))
        });
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
    fn text_and_references_come_out_of_a_document() {
        let doc = json!({"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Plan"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "see "}, {"type": "entityRef", "attrs": {"kind": "pages.page", "id": "p1"}},
                {"type": "entityRef", "attrs": {"kind": "pages.page", "id": "p1"}}, {"type": "entityRef", "attrs": {"kind": "tasks.task", "id": "t9"}}]}]});
        assert_eq!(text_of(&doc), "Plan\nsee");
        assert_eq!(refs_of(&doc), vec![("pages.page".to_string(), "p1".to_string()), ("tasks.task".to_string(), "t9".to_string())]);
    }
}
