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

pub struct Editor;
impl Plugin for Editor {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/editor", "version": "0.1.0", "name": "Editor", "namespaces": ["editor"],
            "description": "Which blocks the rich-text editor offers; other plugins add blocks (editor.block)",
            "requires": {"extension_points": ["editor.block"]},
            "provides": [{"extension_point": "prefs.item", "optional": true}],
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
            let mut added: Vec<(Value, Value)> = vec![];
            for a in answers.as_array().cloned().unwrap_or_default() {
                if a["ok"] == true {
                    for extra in a["output"]["options_for"].as_array().cloned().unwrap_or_default() {
                        // another plugin's option for a block it does not own: kept for the merge below
                        added.push((a["provider"].clone(), extra));
                    }
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
            // Options one plugin adds to a block another owns are merged by node type; an id already there is refused, so two plugins cannot silently fight.
            for (provider, extra) in added {
                let (node, opt) = (extra["node"].as_str().unwrap_or(""), extra["option"].clone());
                let id = opt["id"].as_str().unwrap_or("");
                if node.is_empty() || id.is_empty() {
                    continue;
                }
                let taken = blocks.iter().any(|b| b["node"] == node && b["options"].as_array().is_some_and(|o| o.iter().any(|x| x["id"] == id)));
                if taken {
                    continue;
                }
                if let Some(b) = blocks.iter_mut().find(|b| b["node"] == node) {
                    let mut opt = opt;
                    opt["plugin"] = provider;
                    match b["options"].as_array_mut() {
                        Some(list) => list.push(opt),
                        None => b["options"] = json!([opt]),
                    }
                }
            }
            Ok(json!({"blocks": blocks}))
        });
        // The person's choice of whether the Element tab names the element's type (ADR 0073).
        b.provide("prefs.item", |_tx, _i| {
            Ok(nuah_prefs::pref_answer(vec![json!({"key": "editor.element_type_in_tab", "group": "appearance", "type": "boolean", "default": false,
                "label": {"en": "Show the element's type under the Element tab's name", "ar": "إظهار نوع العنصر تحت اسم تبويب العنصر"}})]))
        });
    }
}

/// A block the slash menu offers. `icon` is a name a Face draws in its own way (the menu shows it before the label).
pub(crate) fn block(id: &str, node: &str, attrs: Value, en: &str, ar: &str, group: &str, keywords: &str, icon: &str) -> Value {
    json!({"id": id, "node": node, "attrs": attrs, "label": {"en": en, "ar": ar}, "group": group, "keywords": keywords, "icon": icon})
}

/// A block with a submenu: choosing it lists `variants` (each has its own id, label and icon, and is inserted like a block of its own).
fn with_variants(mut parent: Value, variants: Vec<Value>) -> Value {
    parent["variants"] = Value::Array(variants);
    parent
}

fn variant(id: &str, en: &str, ar: &str, keywords: &str, icon: &str) -> Value {
    json!({"id": id, "label": {"en": en, "ar": ar}, "keywords": keywords, "icon": icon})
}

/// An option of a block (ADR 0073): a named, typed, labelled attribute with a default. `inherit` lets the page set it for every element of the type.
pub(crate) fn choice(id: &str, en: &str, ar: &str, default: Value, choices: Vec<(Value, &str, &str)>, inherit: bool) -> Value {
    let list: Vec<Value> = choices.into_iter().map(|(v, e, a)| json!({"value": v, "label": {"en": e, "ar": a}})).collect();
    json!({"id": id, "type": "choice", "label": {"en": en, "ar": ar}, "default": default, "choices": list, "inherit": inherit})
}
pub(crate) fn number_opt(id: &str, en: &str, ar: &str, default: Value, min: i64, max: i64, unit: &str) -> Value {
    json!({"id": id, "type": "number", "label": {"en": en, "ar": ar}, "default": default, "min": min, "max": max, "unit": unit})
}
pub(crate) fn date_opt(id: &str, en: &str, ar: &str) -> Value {
    json!({"id": id, "type": "date", "label": {"en": en, "ar": ar}, "default": ""})
}
pub(crate) fn text_opt(id: &str, en: &str, ar: &str) -> Value {
    json!({"id": id, "type": "text", "label": {"en": en, "ar": ar}, "default": ""})
}
pub(crate) fn with_options(mut block: Value, options: Vec<Value>) -> Value {
    block["options"] = Value::Array(options);
    block
}
fn align_option() -> Value {
    choice("align", "Alignment", "المحاذاة", json!("start"), vec![(json!("start"), "Start", "البداية"), (json!("center"), "Centre", "الوسط"), (json!("end"), "End", "النهاية"), (json!("justify"), "Justified", "ضبط")], true)
}
/// A block that is not offered in the slash menu but whose options are shown (plain text).
fn hidden(mut block: Value) -> Value {
    block["insert"] = json!(false);
    block
}

pub struct EditorBasic;
impl Plugin for EditorBasic {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "@madar/editor-basic", "version": "0.1.0", "name": "Basic blocks", "namespaces": ["editor-basic"],
            "description": "Headings, lists, quote, code, checklist, toggle, callouts, image, file, embeds and references",
            "requires": {"plugins": ["@madar/editor"]},
            "provides": [{"extension_point": "editor.block"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("editor.block", |_tx, _i| {
            Ok(json!({"blocks": [
                hidden(with_options(block("paragraph", "paragraph", json!({}), "Text", "نص", "text", "plain paragraph", "type"), vec![align_option()])),
                with_options(block("heading1", "heading", json!({"level": 1}), "Heading 1", "عنوان ١", "text", "title h1", "heading-1"), vec![
                    choice("level", "Level", "المستوى", json!(1), vec![(json!(1), "Heading 1", "عنوان ١"), (json!(2), "Heading 2", "عنوان ٢"), (json!(3), "Heading 3", "عنوان ٣")], false), align_option()]),
                block("heading2", "heading", json!({"level": 2}), "Heading 2", "عنوان ٢", "text", "subtitle h2", "heading-2"),
                block("heading3", "heading", json!({"level": 3}), "Heading 3", "عنوان ٣", "text", "h3", "heading-3"),
                with_options(block("blockquote", "blockquote", json!({}), "Quote", "اقتباس", "text", "blockquote cite", "quote"), vec![align_option()]),
                block("divider", "horizontalRule", json!({}), "Divider", "فاصل", "text", "line hr separator", "divider"),
                with_options(block("codeBlock", "codeBlock", json!({}), "Code block", "كتلة شيفرة", "text", "code snippet", "code"), vec![text_opt("language", "Language", "اللغة")]),
                block("bulletList", "bulletList", json!({}), "Bullet list", "قائمة نقطية", "list", "ul unordered", "list-bullet"),
                with_options(block("orderedList", "orderedList", json!({}), "Numbered list", "قائمة مرقمة", "list", "ol ordered", "list-ordered"), vec![number_opt("start", "Starts at", "يبدأ من", json!(1), 1, 9999, "")]),
                block("taskList", "taskList", json!({}), "Checklist", "قائمة مهام", "list", "todo check task", "list-check"),
                block("toggle", "toggle", json!({}), "Toggle", "قسم قابل للطي", "layout", "collapse fold details", "toggle"),
                with_options(with_variants(block("callout", "callout", json!({"tone": "info"}), "Callout", "تنبيه", "layout", "note highlight box", "callout"), vec![
                    variant("calloutInfo", "Info", "معلومة", "note", "info"),
                    variant("calloutTip", "Tip", "نصيحة", "hint idea", "tip"),
                    variant("calloutWarning", "Warning", "تحذير", "caution", "warning"),
                    variant("calloutDanger", "Danger", "خطر", "error alert", "danger")]), vec![
                    choice("tone", "Kind", "النوع", json!("info"), vec![(json!("info"), "Info", "معلومة"), (json!("tip"), "Tip", "نصيحة"), (json!("warning"), "Warning", "تحذير"), (json!("danger"), "Danger", "خطر")], false)]),
                with_options(block("image", "image", json!({}), "Image", "صورة", "media", "picture photo", "image"), vec![
                    choice("size", "Size", "الحجم", json!("auto"), vec![(json!("auto"), "Original", "الأصلي"), (json!("small"), "Small", "صغير"), (json!("medium"), "Medium", "متوسط"), (json!("large"), "Large", "كبير"), (json!("full"), "Full width", "عرض كامل")], true),
                    text_opt("alt", "Description", "الوصف")]),
                block("file", "fileAttachment", json!({}), "File", "ملف", "media", "attachment upload", "attachment"),
                with_options(block("youtube", "youtube", json!({}), "YouTube", "يوتيوب", "embed", "video", "video"), vec![
                    choice("size", "Size", "الحجم", json!("wide"), vec![(json!("small"), "Small", "صغير"), (json!("medium"), "Medium", "متوسط"), (json!("wide"), "Wide", "عريض"), (json!("full"), "Full width", "عرض كامل")], true),
                    choice("ratio", "Shape", "الشكل", json!("16-9"), vec![(json!("16-9"), "16:9", "16:9"), (json!("4-3"), "4:3", "4:3"), (json!("1-1"), "Square", "مربع")], true),
                    number_opt("start", "Starts at", "يبدأ من", json!(0), 0, 86400, "s")]),
                with_options(block("linkPreview", "linkPreview", json!({}), "Link preview", "معاينة رابط", "embed", "url bookmark", "bookmark"), vec![
                    choice("mode", "Shown as", "العرض", json!("card"), vec![(json!("card"), "Wide card", "بطاقة عريضة"), (json!("compact"), "Compact", "مضغوطة"), (json!("stack"), "Picture on top", "الصورة في الأعلى"), (json!("side"), "Picture at the side", "الصورة على الجانب")], true)]),
                block("subpage", "entityRef", json!({}), "Page", "صفحة", "reference", "page subpage new child nested", "page"),
                block("entityRef", "entityRef", json!({}), "Link to a page or task", "رابط إلى صفحة أو مهمة", "reference", "mention reference link", "mention")
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
            "id": "@madar/refs", "version": "0.1.0", "name": "References", "namespaces": ["refs"],
            "description": "Remembers what refers to what, so every item can show what refers to it",
            "requires": {"plugins": ["@madar/projects"]},
            "data": {"schema": schema(include_str!("../schema/refs.json"))},
            "operations": {
                "refs.to": {"kind": "query", "description": "What refers to an item, inside one project", "permission": "projects.read",
                    "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","kind","id"],"properties":{"project":{"type":"string"},"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}},
                "refs.mine": {"kind": "query", "description": "What refers to one of your own pages",
                    "input": {"type":"object","required":["kind","id"],"properties":{"kind":{"type":"string","maxLength":60},"id":{"type":"string","maxLength":80}},"additionalProperties":false},
                    "output": {"type":"object","required":["links"]}}
            },
            "listeners": [{"id": "refs.record", "on": ["pages.*", "tasks.*", "discussion.*"], "handler": "refs.record"}]
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
