// SPDX-License-Identifier: Apache-2.0
//! `pages`: a tree of rich-text pages, in a project (its Knowledge, `knowledge.*`) or one person's
//! own Pages (`pages.*`). Both sets of Operations share this code. ADR 0022. The storage keeps its first
//! names (`pages.pages` and the `pages.*` Events, for either kind of page).

use crate::content::richtext;
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const PAGES: &str = "pages.pages";
pub const VERSIONS: &str = "pages.versions";
pub const COUNTERS: &str = "pages.counters";
pub const STYLES: &str = "pages.styles";
/// A page keeps a picture of itself from before an editing spell, at most one per ten minutes, the last forty (ADR 0025).
const SPELL_MS: i64 = 600_000;
const KEEP: usize = 40;
const GAP: f64 = 1024.0;
const MAX_DEPTH: usize = 12;
const KIND: &str = "pages.page";

fn view(d: &Doc, with_body: bool) -> Value {
    let b = &d.body;
    let mut v = json!({
        "id": d.id, "rev": d.rev, "number": b.get("number").cloned().unwrap_or(Value::Null), "title": b["title"], "icon": b["icon"], "space": if b["project"].is_null() { b.get("space").cloned().unwrap_or_else(|| json!("default")) } else { Value::Null }, "folder": b.get("folder").cloned().unwrap_or(json!(false)), "parent": b["parent"], "position": b["position"],
        "project": b["project"], "created_by": b["created_by"], "created_at": b["created_at"], "updated_at": b["updated_at"], "settings": b.get("settings").cloned().unwrap_or_else(|| json!({})),
        "tags": b.get("tags").cloned().unwrap_or_else(|| json!([])),
    });
    if with_body {
        v["body"] = b["body"].clone();
    }
    v
}

/// Where the pages of this call live: one project, or the caller's own.
struct Scope {
    project: Option<String>,
    me: String,
}
impl Scope {
    fn of(tx: &Tx, i: &Value, personal: bool) -> Scope {
        Scope { project: if personal { None } else { Some(text(i, "project").to_string()) }, me: tx.who().subject.clone() }
    }
    fn query(&self) -> Query {
        match &self.project {
            Some(p) => Query::new().eq("project", p.as_str()),
            None => Query::new().eq("owner", self.me.as_str()).eq("project", Value::Null),
        }
    }
    fn owns(&self, d: &Doc) -> bool {
        match &self.project {
            Some(p) => text(&d.body, "project") == p,
            None => d.body["project"].is_null() && text(&d.body, "owner") == self.me,
        }
    }
    fn audience(&self) -> Audience {
        match &self.project {
            Some(p) => Audience::scope("projects.members", p),
            None => Audience::subject(&self.me),
        }
    }
    fn event_data(&self, extra: Value) -> Value {
        let mut v = extra;
        v["project"] = self.project.clone().map(Value::from).unwrap_or(Value::Null);
        v
    }
}

fn get(tx: &Tx, s: &Scope, id: &str) -> Result<Doc> {
    let d = tx.get(PAGES, id)?.filter(|d| !d.deleted).ok_or_else(|| Error::not_found("page"))?;
    if s.owns(&d) { Ok(d) } else { Err(Error::not_found("page")) }
}

fn children(tx: &Tx, s: &Scope, parent: &Value) -> Result<Vec<Doc>> {
    Ok(tx.query(PAGES, &s.query().eq("parent", parent.clone()).asc("position").limit(5000))?.items)
}

/// How many pages deep this page sits (a root page is 1).
fn depth_of(tx: &Tx, s: &Scope, mut id: Option<String>) -> Result<usize> {
    let mut n = 0;
    while let Some(i) = id {
        n += 1;
        if n > MAX_DEPTH + 1 {
            break;
        }
        id = get(tx, s, &i)?.body["parent"].as_str().map(String::from);
    }
    Ok(n)
}

/// The page and everything under it, parents before children.
fn subtree(tx: &Tx, s: &Scope, root: &Doc) -> Result<Vec<Doc>> {
    let mut out = vec![root.clone()];
    let mut at = 0;
    while at < out.len() {
        let id = out[at].id.clone();
        out.extend(children(tx, s, &json!(id))?);
        at += 1;
        if out.len() > 5000 {
            return Err(Error::reason(Category::Invalid, "pages.too_big", "That page has too many pages under it"));
        }
    }
    Ok(out)
}

fn height(tx: &Tx, s: &Scope, root: &Doc) -> Result<usize> {
    let mut h = 1;
    let mut level = vec![root.id.clone()];
    while !level.is_empty() {
        let mut next = vec![];
        for id in &level {
            next.extend(children(tx, s, &json!(id))?.into_iter().map(|d| d.id));
        }
        if !next.is_empty() {
            h += 1;
        }
        level = next;
    }
    Ok(h)
}

/// A title is at most 200 characters and may be empty: a page nobody has named is shown as "Untitled" by the Face, so no stand-in word is stored.
fn title_ok(v: &Value) -> Result<()> {
    if v.as_str().is_some_and(|s| s.trim().len() <= 200) { Ok(()) } else { Err(Error::invalid("title", "must be at most 200 characters")) }
}

/// A page's icon is one emoji, never a sentence: at most 14 code points (a family or a flag with its joiners fits) and no spaces.
fn icon_ok(v: Option<&Value>) -> Result<()> {
    match v {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(s)) if !s.is_empty() && s.chars().count() <= 14 && !s.chars().any(|c| c.is_whitespace() || c.is_control()) => Ok(()),
        _ => Err(Error::invalid("icon", "must be a single emoji")),
    }
}

fn create(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    title_ok(&i["title"])?;
    icon_ok(i.get("icon"))?;
    let body = i.get("body").cloned().unwrap_or_else(richtext::empty);
    richtext::check("body", &body)?;
    let folder = i.get("folder").and_then(|f| f.as_bool()).unwrap_or(false);
    let parent = i.get("parent").and_then(|p| p.as_str()).map(String::from);
    // your own pages live in a Space: the parent's, or the one asked for, or the default
    let mut space = i.get("space").and_then(|x| x.as_str()).unwrap_or("default").to_string();
    if s.project.is_none() && parent.is_none() {
        known_space(tx, &space)?;
    }
    if let Some(p) = &parent {
        let up = get(tx, &s, p).map_err(|_| Error::reason(Category::Invalid, "pages.bad_parent", "The parent page is not here"))?;
        if folder && up.body.get("folder") != Some(&json!(true)) {
            return Err(Error::reason(Category::Invalid, "pages.bad_parent", "A folder goes inside a folder"));
        }
        space = up.body.get("space").and_then(|x| x.as_str()).unwrap_or("default").to_string();
        if depth_of(tx, &s, Some(p.clone()))? + 1 > MAX_DEPTH {
            return Err(Error::reason(Category::Invalid, "pages.too_deep", "Pages can be nested 12 levels deep"));
        }
    }
    let last = children(tx, &s, &parent.clone().map(Value::from).unwrap_or(Value::Null))?.last().and_then(|d| d.body["position"].as_f64()).unwrap_or(0.0);
    let now = tx.now();
    let me = s.me.clone();
    let number = match &s.project {
        Some(p) => json!(next_number(tx, COUNTERS, p)?),
        None => Value::Null,
    };
    let d = tx.create(PAGES, json!({
        "number": number, "title": i["title"].as_str().unwrap_or("").trim(), "body": body, "icon": i.get("icon").cloned().unwrap_or(Value::Null), "folder": folder,
        "parent": parent, "position": last + GAP, "project": s.project, "space": if s.project.is_none() { json!(space) } else { Value::Null }, "owner": me, "created_by": me, "created_at": now, "updated_at": now
    }))?;
    let aud = s.audience();
    tx.emit("pages.created", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "parent": d.body["parent"],
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &shown(&d.body))})))?;
    Ok(view(&d, true))
}

fn read(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    Ok(view(&get(tx, &s, text(i, "id"))?, true))
}

fn list(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = tx.query(PAGES, &s.query().asc("position").limit(2000))?;
    // your own pages of one Space (a page from before Spaces belongs to the default one)
    let want = i.get("space").and_then(|x| x.as_str());
    Ok(json!({"pages": page.items.iter().filter(|d| want.is_none_or(|w| d.body.get("space").and_then(|x| x.as_str()).unwrap_or("default") == w)).map(|d| view(d, false)).collect::<Vec<_>>()}))
}

fn snapshot(tx: &mut Tx, old: &Doc, force: bool) -> Result<()> {
    let latest = tx.query(VERSIONS, &Query::new().eq("page", old.id.as_str()).desc("at").limit(KEEP + 1))?.items;
    let now = tx.now();
    if !force && latest.first().is_some_and(|v| now - v.body["at"].as_i64().unwrap_or(0) < SPELL_MS) {
        return Ok(());
    }
    if old.body["body"].is_null() && old.body["title"] == "" {
        return Ok(());
    }
    tx.create(VERSIONS, json!({"page": old.id, "title": old.body["title"], "body": old.body["body"], "at": now,
        "by": tx.who().subject, "edited_at": old.body["updated_at"]}))?;
    for v in latest.iter().skip(KEEP - 1) {
        tx.delete(VERSIONS, &v.id)?;
    }
    Ok(())
}

fn versions(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let rows = tx.query(VERSIONS, &Query::new().eq("page", page.id.as_str()).desc("at").limit(KEEP))?.items;
    Ok(json!({"versions": rows.iter().map(|v| json!({"id": v.id, "at": v.body["at"], "by": v.body["by"], "title": v.body["title"],
        "edited_at": v.body["edited_at"], "text": richtext::text_of(&v.body["body"]).chars().take(160).collect::<String>()})).collect::<Vec<_>>()}))
}

fn version(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let v = tx.get(VERSIONS, text(i, "version"))?.filter(|v| !v.deleted && text(&v.body, "page") == page.id).ok_or_else(|| Error::not_found("version"))?;
    Ok(json!({"id": v.id, "at": v.body["at"], "by": v.body["by"], "title": v.body["title"], "body": v.body["body"]}))
}

/// Put an old picture back. The page as it is now is kept first, so a restore can itself be undone.
fn restore(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let v = tx.get(VERSIONS, text(i, "version"))?.filter(|v| !v.deleted && text(&v.body, "page") == page.id).ok_or_else(|| Error::not_found("version"))?;
    snapshot(tx, &page, true)?;
    let mut b = page.body.clone();
    b["title"] = v.body["title"].clone();
    b["body"] = v.body["body"].clone();
    b["updated_at"] = json!(tx.now());
    let d = tx.put(PAGES, &page.id, b, Expect::Rev(page.rev))?;
    tx.emit("pages.updated", s.audience(), s.event_data(json!({"page": d.id, "title": d.body["title"], "changes": {"body": true, "restored": v.body["at"]},
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &shown(&d.body))})))?;
    Ok(view(&d, true))
}

/// How this page is shown: text (font, size, line height, colour), layout (width, spacing between blocks), colours (the page and its backdrop), a background image,
/// notebook paper (ruled, grid or dotted, a margin line, a rule under each block) and a flavour (the terminal).
/// The page is one endless sheet: the backdrop fills the pane, the page colour is a band behind the text that never ends.
fn check_settings(v: &Value) -> Result<()> {
    let o = v.as_object().ok_or_else(|| Error::invalid("settings", "must be an object"))?;
    let hex = |x: &Value| x.as_str().is_some_and(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit()));
    let int = |x: &Value, lo: i64, hi: i64| x.as_i64().is_some_and(|n| (lo..=hi).contains(&n));
    // an uploaded file, or an https address; nothing else can be a picture here
    let image = |x: &Value| x.as_str().is_some_and(|u| u.len() <= 500 && !u.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'' || c == '(' || c == ')' || c == '\\')
        && (richtext::file_id(u).is_some() || (u.starts_with("https://") && u.len() > 8)));
    for (k, x) in o {
        let ok = match k.as_str() {
            // a font family of a font plugin by id (ADR 0090); `serif` and `mono` are the two choices pages had before families
            "font" => x.as_str().is_some_and(|f| !f.is_empty() && f.len() <= 60 && f.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')),
            // OpenType features the page switches on or off for its font: {"liga": false, "ss01": true}
            "font_features" => x.as_object().is_some_and(|m| m.len() <= 24 && m.iter().all(|(t, v)| t.len() == 4 && t.bytes().all(|b| b.is_ascii_alphanumeric()) && v.is_boolean())),
            "width" => matches!(x.as_str(), Some("narrow" | "normal" | "wide")),
            "size" => x.as_f64().is_some_and(|n| (12.0..=24.0).contains(&n)),
            "page_color" | "bg_color" | "text_color" | "pattern_color" | "margin_line" | "bg_art_color" => hex(x),
            "line_height" => int(x, 100, 260),
            "block_gap" => int(x, 0, 250),
            "pattern" => matches!(x.as_str(), Some("none" | "ruled" | "grid" | "dots")),
            "block_rule" => matches!(x.as_str(), Some("none" | "line" | "dashed" | "dotted")),
            "band_shadow" => x.is_boolean(),
            "flavor" => matches!(x.as_str(), Some("terminal")),
            "bg_art" => matches!(x.as_str(), Some("leaves")),
            "sheet_art" => matches!(x.as_str(), Some("autumn")),
            "sheet_image" => image(x),
            "sheet_corner" => matches!(x.as_str(), Some("top-right" | "top-left" | "bottom-right" | "bottom-left")),
            "sheet_size" => int(x, 40, 600),
            "sheet_mirror" => x.is_boolean(),
            "preset" => x.as_str().is_some_and(|v| !v.is_empty() && v.len() <= 24 && v.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')),
            "preset_mode" => matches!(x.as_str(), Some("light" | "dark")),
            "page_opacity" => int(x, 0, 100),
            "bg_image" => image(x),
            "bg_fit" => matches!(x.as_str(), Some("cover" | "contain" | "scale" | "tile")),
            "bg_scale" => int(x, 10, 300),
            "bg_tile" => int(x, 40, 800),
            "bg_attach" => matches!(x.as_str(), Some("fixed" | "scroll")),
            "bg_dim" => int(x, 0, 80),
            // what the page sets for every element of a type: {node: {option: value}} (ADR 0073)
            "elements" => elements_ok(x),
            _ => return Err(Error::invalid(&format!("settings.{k}"), "is not a page setting")),
        };
        if !ok {
            return Err(Error::invalid(&format!("settings.{k}"), "is not an allowed value"));
        }
    }
    Ok(())
}

/// A page's defaults for element types: at most 20 types with at most 20 options each, words as keys, and simple values.
fn elements_ok(v: &Value) -> bool {
    let word = |s: &str| !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    v.as_object().is_some_and(|o| o.len() <= 20 && o.iter().all(|(k, opts)| word(k) && opts.as_object().is_some_and(|m| m.len() <= 20 && m.iter().all(|(n, x)| word(n)
        && (x.is_boolean() || x.as_f64().is_some_and(|f| f.is_finite()) || x.as_str().is_some_and(|t| t.chars().count() <= 60 && !t.chars().any(|c| c.is_control())))))))
}

/// What a page shows, for the references that keep uploaded files alive: its text and its background image.
fn shown(b: &Value) -> Value {
    let pic = |k: &str| b.get("settings").and_then(|s| s.get(k)).cloned().unwrap_or(Value::Null);
    json!({"type": "doc", "content": [b["body"].clone(), {"type": "background", "attrs": {"src": pic("bg_image")}}, {"type": "background", "attrs": {"src": pic("sheet_image")}}]})
}

const MAX_TAGS: usize = 20;
const MAX_TAG: usize = 40;

/// A page's tags as stored: trimmed, 1 to 40 characters without control characters, no two alike when case is ignored, at most 20.
fn tags_ok(v: &Value) -> Result<Vec<String>> {
    let a = v.as_array().ok_or_else(|| Error::invalid("tags", "must be a list"))?;
    let mut out: Vec<String> = vec![];
    for t in a {
        let t = t.as_str().ok_or_else(|| Error::invalid("tags", "must be text"))?.trim();
        if t.is_empty() || t.chars().count() > MAX_TAG || t.chars().any(|c| c.is_control()) {
            return Err(Error::invalid("tags", "a tag is 1 to 40 characters"));
        }
        if !out.iter().any(|o| o.to_lowercase() == t.to_lowercase()) {
            out.push(t.to_string());
        }
    }
    if out.len() > MAX_TAGS {
        return Err(Error::reason(Category::Invalid, "pages.too_many_tags", "A page can have up to 20 tags"));
    }
    Ok(out)
}

fn update(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let old = get(tx, &s, text(i, "id"))?;
    let mut b = old.body.clone();
    let mut changes = serde_json::Map::new();
    if let Some(t) = i.get("title") {
        title_ok(t)?;
        b["title"] = json!(t.as_str().unwrap_or("").trim());
        changes.insert("title".into(), json!([old.body["title"], b["title"]]));
    }
    if let Some(body) = i.get("body") {
        richtext::check("body", body)?;
        if body != &old.body["body"] {
            changes.insert("body".into(), json!(true));
        }
        b["body"] = body.clone();
    }
    if let Some(icon) = i.get("icon") {
        icon_ok(Some(icon))?;
        b["icon"] = icon.clone();
        changes.insert("icon".into(), json!([old.body["icon"], icon]));
    }
    if let Some(tg) = i.get("tags") {
        let tags = json!(tags_ok(tg)?);
        if tags != old.body.get("tags").cloned().unwrap_or_else(|| json!([])) {
            b["tags"] = tags;
            changes.insert("tags".into(), json!(true));
        }
    }
    if let Some(st) = i.get("settings") {
        check_settings(st)?;
        if st != &old.body.get("settings").cloned().unwrap_or_else(|| json!({})) {
            b["settings"] = st.clone();
            changes.insert("settings".into(), json!(true));
        }
    }
    if changes.is_empty() {
        return Ok(view(&old, true));
    }
    b["updated_at"] = json!(tx.now());
    if changes.contains_key("body") || changes.contains_key("title") {
        snapshot(tx, &old, false)?;
    }
    let expect = Expect::Rev(i.get("expected_rev").and_then(|r| r.as_u64()).unwrap_or(old.rev));
    let d = tx.put(PAGES, &old.id, b, expect).map_err(|e| stale(e, "pages.stale_revision", "The page"))?;
    let aud = s.audience();
    tx.emit("pages.updated", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "changes": changes,
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &shown(&d.body))})))?;
    Ok(view(&d, true))
}

fn move_page(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let parent = i.get("parent").and_then(|p| p.as_str()).map(String::from);
    if let Some(p) = &parent {
        let up = get(tx, &s, p).map_err(|_| Error::reason(Category::Invalid, "pages.bad_parent", "The parent page is not here"))?;
        if page.body.get("folder") == Some(&json!(true)) && up.body.get("folder") != Some(&json!(true)) {
            return Err(Error::reason(Category::Invalid, "pages.bad_parent", "A folder goes inside a folder"));
        }
        // not into itself or anything under itself
        let mut up = Some(p.clone());
        while let Some(u) = up {
            if u == page.id {
                return Err(Error::reason(Category::Invalid, "pages.bad_parent", "A page cannot go under itself"));
            }
            up = get(tx, &s, &u)?.body["parent"].as_str().map(String::from);
        }
    }
    if depth_of(tx, &s, parent.clone())? + height(tx, &s, &page)? > MAX_DEPTH {
        return Err(Error::reason(Category::Invalid, "pages.too_deep", "Pages can be nested 12 levels deep"));
    }
    let pv = parent.clone().map(Value::from).unwrap_or(Value::Null);
    let mut sibs: Vec<Doc> = children(tx, &s, &pv)?.into_iter().filter(|d| d.id != page.id).collect();
    let before = i.get("before").and_then(|b| b.as_str());
    let idx = before.and_then(|b| sibs.iter().position(|d| d.id == b)).unwrap_or(sibs.len());
    let pos_of = |d: &Doc| d.body["position"].as_f64().unwrap_or(0.0);
    let lo = if idx == 0 { None } else { Some(pos_of(&sibs[idx - 1])) };
    let hi = sibs.get(idx).map(pos_of);
    let mut position = match (lo, hi) {
        (None, None) => GAP,
        (Some(l), None) => l + GAP,
        (None, Some(h)) => h / 2.0,
        (Some(l), Some(h)) => (l + h) / 2.0,
    };
    // positions that ran out of room are spread out again
    if let (Some(l), Some(h)) = (lo, hi) {
        if (h - l).abs() < 1e-6 {
            for (n, d) in sibs.iter_mut().enumerate() {
                let mut b = d.body.clone();
                b["position"] = json!((n as f64 + 1.0) * GAP * 2.0);
                *d = tx.put(PAGES, &d.id, b, Expect::Rev(d.rev))?;
            }
            let (l, h) = (if idx == 0 { None } else { Some(pos_of(&sibs[idx - 1])) }, sibs.get(idx).map(pos_of));
            position = match (l, h) {
                (Some(l), Some(h)) => (l + h) / 2.0,
                _ => position,
            };
        }
    }
    let mut b = page.body.clone();
    b["parent"] = pv;
    b["position"] = json!(position);
    b["updated_at"] = json!(tx.now());
    let d = tx.put(PAGES, &page.id, b, Expect::Rev(page.rev))?;
    let aud = s.audience();
    tx.emit("pages.moved", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "parent": d.body["parent"], "position": position})))?;
    Ok(view(&d, false))
}

/// The kinds of block that are tasks (ADR 0075), from what the blocks declare: `{node: {done, due, priority, notes}}` (the names of the attributes). With no editor, none.
fn task_nodes(tx: &mut Tx) -> std::collections::BTreeMap<String, Value> {
    let blocks = tx.call("editor.blocks", json!({})).ok().and_then(|b| b["blocks"].as_array().cloned()).unwrap_or_default();
    blocks.into_iter().filter(|b| b["task"].is_object()).filter_map(|b| Some((b["node"].as_str()?.to_string(), b["task"].clone()))).collect()
}

/// One task block of a document: its block id, whether it is done, its title (the first line), and its details.
struct TaskRow { block: Option<String>, done: bool, text: String, due: Value, priority: Value, notes: Value }

fn task_blocks(doc: &Value, kinds: &std::collections::BTreeMap<String, Value>) -> Vec<TaskRow> {
    fn go(n: &Value, kinds: &std::collections::BTreeMap<String, Value>, out: &mut Vec<TaskRow>) {
        if let Some(map) = n["type"].as_str().and_then(|t| kinds.get(t)) {
            let at = |k: &str| map[k].as_str().map(|a| n["attrs"][a].clone()).unwrap_or(Value::Null);
            let line = richtext::text_of(n).lines().next().unwrap_or("").trim().chars().take(200).collect::<String>();
            let text = |v: Value| if v.as_str().is_some_and(|s| s.is_empty()) { Value::Null } else { v };
            out.push(TaskRow { block: n["attrs"]["blockId"].as_str().map(String::from), done: at("done") == true, text: line, due: text(at("due")), priority: text(at("priority")), notes: text(at("notes")) });
        }
        for k in n["content"].as_array().into_iter().flatten() {
            go(k, kinds, out);
        }
    }
    let mut out = vec![];
    go(doc, kinds, &mut out);
    out
}

/// The open task blocks on the pages you can see: your own pages (of one Space, when asked) and the pages of your projects. Ones with a due date come first, soonest first; the rest follow, newest page first. A checklist is not a task (ADR 0075).
fn page_tasks(tx: &mut Tx, i: &Value) -> Result<Value> {
    let me = tx.who().subject.clone();
    let want = i.get("space").and_then(|x| x.as_str());
    let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(100) as usize;
    let kinds = task_nodes(tx);
    if kinds.is_empty() {
        return Ok(json!({"items": []}));
    }
    let mut rows: Vec<(i64, Value)> = vec![];
    let take = |d: &Doc, project: Option<&Value>, rows: &mut Vec<(i64, Value)>| {
        if d.body.get("folder") == Some(&json!(true)) {
            return;
        }
        for t in task_blocks(&d.body["body"], &kinds) {
            if !t.done && !t.text.is_empty() {
                rows.push((d.body["updated_at"].as_i64().unwrap_or(0), json!({"page": d.id, "title": d.body["title"], "icon": d.body["icon"], "block": t.block, "text": t.text,
                    "due": t.due, "priority": t.priority, "notes": t.notes,
                    "project": project.map(|p| p["id"].clone()).unwrap_or(Value::Null), "project_name": project.map(|p| p["name"].clone()).unwrap_or(Value::Null)})));
            }
        }
    };
    for d in tx.query(PAGES, &Query::new().eq("owner", me.as_str()).eq("project", Value::Null).limit(2000))?.items {
        if want.is_none_or(|w| d.body.get("space").and_then(|x| x.as_str()).unwrap_or("default") == w) {
            take(&d, None, &mut rows);
        }
    }
    // a project's pages belong to the Space the project is in
    let projects = tx.call("projects.list", json!({}))?;
    for p in projects["projects"].as_array().cloned().unwrap_or_default() {
        if want.is_some_and(|w| text(&p, "space") != w) {
            continue;
        }
        for d in tx.query(PAGES, &Query::new().eq("project", text(&p, "id")).limit(2000))?.items {
            take(&d, Some(&p), &mut rows);
        }
    }
    // dated first, soonest first (an overdue one is soonest); then the rest, newest page first
    rows.sort_by(|a, b| match (a.1["due"].as_str(), b.1["due"].as_str()) {
        (Some(x), Some(y)) => x.cmp(y).then(b.0.cmp(&a.0)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.0.cmp(&a.0),
    });
    rows.truncate(limit);
    Ok(json!({"items": rows.into_iter().map(|(_, r)| r).collect::<Vec<_>>()}))
}

/// Tick or untick one task block of a page, found by its block id.
fn set_task(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let (block, checked) = (text(i, "block").to_string(), i["checked"] == true);
    let kinds = task_nodes(tx);
    fn go(n: &mut Value, block: &str, checked: bool, kinds: &std::collections::BTreeMap<String, Value>) -> bool {
        if let Some(done) = n["type"].as_str().and_then(|t| kinds.get(t)).and_then(|m| m["done"].as_str()).map(String::from) {
            if n["attrs"]["blockId"] == block {
                n["attrs"][done.as_str()] = json!(checked);
                return true;
            }
        }
        // `get_mut`, not an index: indexing a node that has no content would add `content: null` to it
        n.get_mut("content").and_then(|c| c.as_array_mut()).is_some_and(|k| k.iter_mut().any(|c| go(c, block, checked, kinds)))
    }
    let mut body = page.body["body"].clone();
    if !go(&mut body, &block, checked, &kinds) {
        return Err(Error::not_found("task"));
    }
    let mut input = json!({"id": page.id, "body": body});
    if let Some(p) = i.get("project") {
        input["project"] = p.clone();
    }
    update(tx, &input, personal)
}

/// A Space your own pages may live in: your own (`default`) or one you are in (ADR 0083).
fn known_space(tx: &mut Tx, space: &str) -> Result<()> {
    if space == "default" {
        return Ok(());
    }
    let mine = tx.call("spaces.list", json!({}))?;
    if mine["spaces"].as_array().is_some_and(|l| l.iter().any(|s| s["id"] == space)) {
        Ok(())
    } else {
        Err(Error::not_found("space"))
    }
}

/// Move one of your own pages, with everything under it, into another Space. A page that was under a page of the old Space becomes a top page.
fn set_space(tx: &mut Tx, i: &Value) -> Result<Value> {
    let s = Scope::of(tx, i, true);
    let page = get(tx, &s, text(i, "id"))?;
    let space = text(i, "space").to_string();
    if page.body.get("space").and_then(|x| x.as_str()).unwrap_or("default") == space {
        return Ok(view(&page, false));
    }
    known_space(tx, &space)?;
    let all = subtree(tx, &s, &page)?;
    let mut root = None;
    for d in all {
        let mut b = d.body.clone();
        b["space"] = json!(space);
        if d.id == page.id {
            b["parent"] = Value::Null;
            b["position"] = json!(children(tx, &s, &Value::Null)?.last().and_then(|x| x.body["position"].as_f64()).unwrap_or(0.0) + GAP);
        }
        let nd = tx.put(PAGES, &d.id, b, Expect::Rev(d.rev))?;
        if nd.id == page.id {
            root = Some(nd);
        }
    }
    let d = root.expect("the page itself");
    tx.emit("pages.moved", s.audience(), s.event_data(json!({"page": d.id, "title": d.body["title"], "parent": Value::Null, "space": space})))?;
    Ok(view(&d, false))
}

fn remove(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let all = subtree(tx, &s, &page)?;
    for d in all.iter().rev() {
        tx.delete(PAGES, &d.id)?;
        for v in tx.query(VERSIONS, &Query::new().eq("page", d.id.as_str()).limit(100))?.items {
            tx.delete(VERSIONS, &v.id)?;
        }
        let aud = s.audience();
        tx.emit("pages.removed", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "files": richtext::files_of(&shown(&d.body)), "refs": richtext::refs_for(KIND, &d.id, "", &Value::Null)})))?;
    }
    Ok(json!({"removed": all.len()}))
}

fn search(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let raw = text(i, "q").trim().to_lowercase();
    // `#name` means the tag
    let (q, by_tag) = match raw.strip_prefix('#') { Some(t) => (t.to_string(), true), None => (raw, false) };
    let page = tx.query(PAGES, &s.query().limit(2000))?;
    let tagged = |d: &Doc| d.body["tags"].as_array().is_some_and(|t| t.iter().any(|x| x.as_str().is_some_and(|x| if by_tag { x.to_lowercase() == q } else { x.to_lowercase().contains(&q) })));
    let hits: Vec<Value> = page.items.iter().filter(|d| d.body.get("folder") != Some(&json!(true)) && ((!by_tag && text(&d.body, "title").to_lowercase().contains(&q)) || tagged(d))).take(30).map(|d| view(d, false)).collect();
    Ok(json!({"pages": hits}))
}

/// The tags in use on these pages, most used first, for suggestions and filtering.
fn tags(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = tx.query(PAGES, &s.query().limit(2000))?;
    let mut count: std::collections::BTreeMap<String, (String, u32)> = Default::default();
    for d in &page.items {
        for t in d.body["tags"].as_array().into_iter().flatten().filter_map(|t| t.as_str()) {
            count.entry(t.to_lowercase()).or_insert_with(|| (t.to_string(), 0)).1 += 1;
        }
    }
    let mut rows: Vec<(String, u32)> = count.into_values().collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    Ok(json!({"tags": rows.into_iter().map(|(tag, pages)| json!({"tag": tag, "pages": pages})).collect::<Vec<_>>()}))
}

// ---- your own page styles: a look you saved, with its background image, kept with your data ----

const MAX_STYLES: usize = 60;

fn style_view(d: &Doc) -> Value {
    json!({"id": d.id, "name": d.body["name"], "settings": d.body["settings"]})
}

/// What a saved style shows, for the references that keep its background image alive.
fn style_shown(settings: &Value) -> Value {
    let pic = |k: &str| settings.get(k).cloned().unwrap_or(Value::Null);
    json!({"type": "doc", "content": [{"type": "background", "attrs": {"src": pic("bg_image")}}, {"type": "background", "attrs": {"src": pic("sheet_image")}}]})
}

fn styles(tx: &mut Tx, _i: &Value) -> Result<Value> {
    let me = tx.who().subject.clone();
    let all = tx.query(STYLES, &Query::new().eq("owner", me.as_str()).asc("created_at").limit(200))?.items;
    Ok(json!({"styles": all.iter().map(style_view).collect::<Vec<_>>()}))
}

fn style_save(tx: &mut Tx, i: &Value) -> Result<Value> {
    let s = Scope::of(tx, i, true);
    let name = text(i, "name").trim().to_string();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(Error::reason(Category::Invalid, "pages.bad_style_name", "A style needs a name of up to 40 characters"));
    }
    let settings = i.get("settings").cloned().unwrap_or_else(|| json!({}));
    check_settings(&settings)?;
    let now = tx.now();
    let d = match i.get("id").and_then(|x| x.as_str()) {
        Some(id) => {
            let old = tx.get(STYLES, id)?.filter(|d| !d.deleted && text(&d.body, "owner") == s.me).ok_or_else(|| Error::not_found("style"))?;
            let mut b = old.body.clone();
            b["name"] = json!(name);
            b["settings"] = settings.clone();
            b["updated_at"] = json!(now);
            tx.put(STYLES, id, b, Expect::Rev(old.rev))?
        }
        None => {
            let n = tx.query(STYLES, &Query::new().eq("owner", s.me.as_str()).limit(MAX_STYLES + 1))?.items.len();
            if n >= MAX_STYLES {
                return Err(Error::reason(Category::Invalid, "pages.too_many_styles", "You can keep up to 60 styles"));
            }
            tx.create(STYLES, json!({"name": name, "settings": settings, "owner": s.me, "created_at": now, "updated_at": now}))?
        }
    };
    tx.emit("pages.style.saved", s.audience(), s.event_data(json!({"style": d.id, "name": d.body["name"], "refs": richtext::refs_for("pages.style", &d.id, text(&d.body, "name"), &style_shown(&d.body["settings"]))})))?;
    Ok(style_view(&d))
}

fn style_delete(tx: &mut Tx, i: &Value) -> Result<Value> {
    let s = Scope::of(tx, i, true);
    let d = tx.get(STYLES, text(i, "id"))?.filter(|d| !d.deleted && text(&d.body, "owner") == s.me).ok_or_else(|| Error::not_found("style"))?;
    tx.delete(STYLES, &d.id)?;
    tx.emit("pages.style.removed", s.audience(), s.event_data(json!({"style": d.id, "files": richtext::files_of(&style_shown(&d.body["settings"])), "refs": richtext::refs_for("pages.style", &d.id, "", &Value::Null)})))?;
    Ok(json!({"removed": 1}))
}

fn ops_for(prefix: &str, personal: bool) -> Value {
    let proj = json!({"type":"string"});
    let mut m = serde_json::Map::new();
    let mut add = |name: &str, kind: &str, write: bool, desc: &str, props: Value, required: Vec<&str>| {
        let mut props = props.as_object().cloned().unwrap_or_default();
        let mut req: Vec<Value> = required.iter().map(|r| json!(r)).collect();
        let mut op = json!({"kind": kind, "description": desc});
        if !personal {
            props.insert("project".into(), proj.clone());
            req.insert(0, json!("project"));
            op["permission"] = json!(if write { "projects.write" } else { "projects.read" });
            op["resource"] = json!({"type": "projects.project", "id": "project"});
        }
        op["input"] = json!({"type": "object", "required": req, "properties": props, "additionalProperties": false});
        m.insert(format!("{prefix}.{name}"), op);
    };
    let title = json!({"type":"string","maxLength":200});
    let doc = json!({"type":"object"});
    let id = json!({"type":"string"});
    let nullable = json!({"type":["string","null"]});
    let scope = if personal { "your own pages" } else { "this project's knowledge" };
    add("create", "command", true, &format!("Add a page to {scope}"), json!({"title": title, "body": doc, "parent": nullable, "icon": nullable, "folder": {"type":"boolean"}, "space": {"type":"string","maxLength":60}}), vec!["title"]);
    add("get", "query", false, "One page with its body", json!({"id": id}), vec!["id"]);
    add("list", "query", false, &format!("The tree of {scope}, without bodies; your own pages can be limited to one Space"), if personal { json!({"space": {"type":"string","maxLength":60}}) } else { json!({}) }, vec![]);
    add("set_task", "command", true, "Tick or untick a task block of a page, found by its block id", json!({"id": id, "block": {"type":"string","minLength":1,"maxLength":40}, "checked": {"type":"boolean"}}), vec!["id", "block", "checked"]);
    if personal {
        add("tasks", "query", false, "The open task blocks on your pages (of one Space) and on the pages of your projects", json!({"space": {"type":"string","maxLength":60}, "limit": {"type":"integer","minimum":1,"maximum":300}}), vec![]);
        add("styles", "query", false, "The page styles you saved", json!({}), vec![]);
        add("style_save", "command", true, "Save a page style under a name (a new one, or replace one of yours)", json!({"id": id, "name": {"type":"string","minLength":1,"maxLength":40}, "settings": {"type":"object"}}), vec!["name", "settings"]);
        add("style_delete", "command", true, "Delete one of your saved page styles", json!({"id": id}), vec!["id"]);
        add("set_space", "command", true, "Move one of your pages, with the pages under it, into another Space", json!({"id": id, "space": {"type":"string","minLength":1,"maxLength":60}}), vec!["id", "space"]);
    }
    add("update", "command", true, "Change a page's title, body, icon or tags", json!({"id": id, "title": title, "body": doc, "icon": nullable, "settings": {"type":"object"}, "tags": {"type":"array","maxItems":20,"items":{"type":"string","minLength":1,"maxLength":40}}, "expected_rev": {"type":"integer","minimum":1}}), vec!["id"]);
    add("move", "command", true, "Move a page under another (or to the top), before a sibling", json!({"id": id, "parent": nullable, "before": nullable}), vec!["id"]);
    add("delete", "command", true, "Delete a page and everything under it", json!({"id": id}), vec!["id"]);
    add("versions", "query", false, "The saved earlier pictures of a page, newest first", json!({"id": id}), vec!["id"]);
    add("version", "query", false, "One earlier picture of a page, with its body", json!({"id": id, "version": id}), vec!["id", "version"]);
    add("restore", "command", true, "Put an earlier picture back", json!({"id": id, "version": id}), vec!["id", "version"]);
    add("tags", "query", false, &format!("The tags in use on {scope}, most used first"), json!({}), vec![]);
    add("search", "query", false, &format!("Find pages in {scope} by title or tag (#tag for a tag)"), json!({"q": {"type":"string","minLength":1,"maxLength":100}}), vec!["q"]);
    // what each operation returns, from `schemas` (the Core checks it; the Face's client is generated from it)
    for (name, out) in [("create", crate::schemas::page()), ("get", crate::schemas::page()), ("list", crate::schemas::pages()), ("update", crate::schemas::page()),
        ("move", crate::schemas::page_item()), ("delete", crate::schemas::removed()), ("restore", crate::schemas::page()), ("tasks", crate::schemas::page_tasks()),
        ("set_space", crate::schemas::page_item()), ("tags", crate::schemas::page_tags()), ("styles", crate::schemas::page_styles()), ("style_delete", crate::schemas::removed()),
        ("set_task", crate::schemas::page()), ("search", crate::schemas::pages()), ("versions", crate::schemas::page_versions()), ("version", crate::schemas::page_version()), ("style_save", crate::schemas::page_style())] {
        if let Some(op) = m.get_mut(&format!("{prefix}.{name}")) {
            op["output"] = out;
        }
    }
    Value::Object(m)
}

pub struct Pages;
impl Plugin for Pages {
    fn manifest(&self) -> Manifest {
        let mut ops = ops_for("knowledge", false).as_object().cloned().unwrap();
        ops.extend(ops_for("pages", true).as_object().cloned().unwrap());
        manifest(json!({
            "id": "@madar/pages", "version": "0.1.0", "name": "Pages", "namespaces": ["knowledge", "pages"],
            "description": "A tree of rich-text pages: a project's Knowledge (knowledge.*) and your own Pages (pages.*)",
            "requires": {"plugins": ["@madar/projects", "@madar/spaces"], "capabilities": ["emit", "call"]},
            "provides": [{"extension_point": "search.source", "optional": true}],
            "data": {"collections": [PAGES, VERSIONS, COUNTERS, STYLES], "version": 2,
                     "indexes": [{"collection": PAGES, "field": "project"}, {"collection": PAGES, "field": "owner"}, {"collection": PAGES, "field": "parent"}, {"collection": VERSIONS, "field": "page"}]},
            "events": {"pages.created": {}, "pages.updated": {}, "pages.moved": {}, "pages.removed": {}, "pages.style.saved": {}, "pages.style.removed": {}},
            "operations": ops
        }))
    }
    fn migrate(&self, from: u32, tx: &mut Tx) -> Result<()> {
        if from != 1 {
            return Ok(());
        }
        // version 2: number each project's pages in the order they were made (notes have no project, so no number)
        let all = tx.query(PAGES, &Query::new().asc("created_at").limit(20000))?.items;
        let mut last: std::collections::BTreeMap<String, i64> = Default::default();
        for d in &all {
            if let (Some(n), Some(p)) = (d.body["number"].as_i64(), d.body["project"].as_str()) {
                let e = last.entry(p.to_string()).or_insert(0);
                *e = (*e).max(n);
            }
        }
        for d in all.into_iter().filter(|d| d.body["number"].is_null() && d.body["project"].is_string()) {
            let e = last.entry(text(&d.body, "project").to_string()).or_insert(0);
            *e += 1;
            let mut body = d.body.clone();
            body["number"] = json!(*e);
            tx.put(PAGES, &d.id, body, Expect::Rev(d.rev))?;
        }
        for (project, n) in last {
            tx.put(COUNTERS, &project, json!({"next": n + 1}), Expect::Any)?;
        }
        Ok(())
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("search.source", |tx, i| {
            let q = text(&i, "q").to_string();
            // `#name` asks for the pages that carry that tag; anything else searches words
            let by_tag = q.trim().strip_prefix('#').map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty());
            let projects = tx.call("projects.list", json!({}))?;
            let me = tx.who().subject.clone();
            let mut items = vec![];
            let mut hit = |d: &Doc, kind: &str, project: Option<&Value>| {
                if d.body.get("folder") == Some(&json!(true)) {
                    return;
                }
                let found = match &by_tag {
                    Some(t) => d.body["tags"].as_array().is_some_and(|x| x.iter().any(|y| y.as_str().is_some_and(|y| y.to_lowercase() == *t))).then(|| (10.0, String::new())),
                    None => crate::search::score(&q, text(&d.body, "title"), &richtext::text_of(&d.body["body"])),
                };
                if let Some((score, snippet)) = found {
                    items.push(json!({"kind": kind, "id": d.id, "title": d.body["title"], "snippet": snippet, "score": score, "tags": d.body.get("tags").cloned().unwrap_or_else(|| json!([])),
                        "project": project.map(|p| p["id"].clone()).unwrap_or(Value::Null), "project_name": project.map(|p| p["name"].clone()).unwrap_or(Value::Null),
                        "space": if project.is_none() { d.body.get("space").cloned().unwrap_or_else(|| json!("default")) } else { Value::Null }}));
                }
            };
            for p in projects["projects"].as_array().cloned().unwrap_or_default() {
                for d in tx.query(PAGES, &Query::new().eq("project", text(&p, "id")).limit(2000))?.items {
                    hit(&d, "knowledge", Some(&p));
                }
            }
            for d in tx.query(PAGES, &Query::new().eq("owner", me.as_str()).eq("project", Value::Null).limit(2000))?.items {
                hit(&d, "page", None);
            }
            items.sort_by(|a, b| b["score"].as_f64().partial_cmp(&a["score"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
            items.truncate(50);
            Ok(json!({"items": items}))
        });
        b.op("pages.set_space", |tx, i| set_space(tx, &i));
        b.op("pages.styles", |tx, i| styles(tx, &i));
        b.op("pages.style_save", |tx, i| style_save(tx, &i));
        b.op("pages.style_delete", |tx, i| style_delete(tx, &i));
        b.op("pages.tasks", |tx, i| page_tasks(tx, &i));
        b.op("pages.set_task", |tx, i| set_task(tx, &i, true));
        b.op("knowledge.set_task", |tx, i| set_task(tx, &i, false));
        type H = fn(&mut Tx, &Value, bool) -> Result<Value>;
        let all: [(&str, H); 11] = [("versions", versions), ("version", version), ("restore", restore), ("create", create), ("get", read), ("list", list), ("update", update), ("move", move_page), ("delete", remove), ("search", search), ("tags", tags)];
        for (prefix, personal) in [("knowledge", false), ("pages", true)] {
            for (name, f) in all {
                b.op(&format!("{prefix}.{name}"), move |tx, i| f(tx, &i, personal));
            }
        }
    }
}
