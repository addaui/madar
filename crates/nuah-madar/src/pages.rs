//! `pages`: a tree of rich-text pages, in a project (its knowledge base, `pages.*`) or one person's
//! own notes (`notes.*`). Both sets of Operations share this code. ADR 0022.

use crate::content::richtext;
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const PAGES: &str = "pages.pages";
pub const VERSIONS: &str = "pages.versions";
/// A page keeps a picture of itself from before an editing spell, at most one per ten minutes, the last forty (ADR 0025).
const SPELL_MS: i64 = 600_000;
const KEEP: usize = 40;
const GAP: f64 = 1024.0;
const MAX_DEPTH: usize = 12;
const KIND: &str = "pages.page";

fn view(d: &Doc, with_body: bool) -> Value {
    let b = &d.body;
    let mut v = json!({
        "id": d.id, "rev": d.rev, "title": b["title"], "icon": b["icon"], "parent": b["parent"], "position": b["position"],
        "project": b["project"], "created_by": b["created_by"], "created_at": b["created_at"], "updated_at": b["updated_at"],
    });
    if with_body {
        v["body"] = b["body"].clone();
    }
    v
}

/// Where the pages of this call live: one project, or the caller's own notes.
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

fn title_ok(v: &Value) -> Result<()> {
    if v.as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= 200) { Ok(()) } else { Err(Error::invalid("title", "must be 1 to 200 characters")) }
}

fn create(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    title_ok(&i["title"])?;
    let body = i.get("body").cloned().unwrap_or_else(richtext::empty);
    richtext::check("body", &body)?;
    let parent = i.get("parent").and_then(|p| p.as_str()).map(String::from);
    if let Some(p) = &parent {
        get(tx, &s, p).map_err(|_| Error::reason(Category::Invalid, "pages.bad_parent", "The parent page is not here"))?;
        if depth_of(tx, &s, Some(p.clone()))? + 1 > MAX_DEPTH {
            return Err(Error::reason(Category::Invalid, "pages.too_deep", "Pages can be nested 12 levels deep"));
        }
    }
    let last = children(tx, &s, &parent.clone().map(Value::from).unwrap_or(Value::Null))?.last().and_then(|d| d.body["position"].as_f64()).unwrap_or(0.0);
    let now = tx.now();
    let me = s.me.clone();
    let d = tx.create(PAGES, json!({
        "title": i["title"].as_str().unwrap_or("").trim(), "body": body, "icon": i.get("icon").cloned().unwrap_or(Value::Null),
        "parent": parent, "position": last + GAP, "project": s.project, "owner": me, "created_by": me, "created_at": now, "updated_at": now
    }))?;
    let aud = s.audience();
    tx.emit("pages.created", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "parent": d.body["parent"],
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &d.body["body"])})))?;
    Ok(view(&d, true))
}

fn read(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    Ok(view(&get(tx, &s, text(i, "id"))?, true))
}

fn list(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = tx.query(PAGES, &s.query().asc("position").limit(2000))?;
    Ok(json!({"pages": page.items.iter().map(|d| view(d, false)).collect::<Vec<_>>()}))
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
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &d.body["body"])})))?;
    Ok(view(&d, true))
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
        b["icon"] = icon.clone();
        changes.insert("icon".into(), json!([old.body["icon"], icon]));
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
        "refs": richtext::refs_for(KIND, &d.id, text(&d.body, "title"), &d.body["body"])})))?;
    Ok(view(&d, true))
}

fn move_page(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let page = get(tx, &s, text(i, "id"))?;
    let parent = i.get("parent").and_then(|p| p.as_str()).map(String::from);
    if let Some(p) = &parent {
        get(tx, &s, p).map_err(|_| Error::reason(Category::Invalid, "pages.bad_parent", "The parent page is not here"))?;
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
        tx.emit("pages.removed", aud, s.event_data(json!({"page": d.id, "title": d.body["title"], "files": richtext::files_of(&d.body["body"]), "refs": richtext::refs_for(KIND, &d.id, "", &Value::Null)})))?;
    }
    Ok(json!({"removed": all.len()}))
}

fn search(tx: &mut Tx, i: &Value, personal: bool) -> Result<Value> {
    let s = Scope::of(tx, i, personal);
    let q = text(i, "q").to_lowercase();
    let page = tx.query(PAGES, &s.query().limit(2000))?;
    let hits: Vec<Value> = page.items.iter().filter(|d| text(&d.body, "title").to_lowercase().contains(&q)).take(30).map(|d| view(d, false)).collect();
    Ok(json!({"pages": hits}))
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
    let title = json!({"type":"string","minLength":1,"maxLength":200});
    let doc = json!({"type":"object"});
    let id = json!({"type":"string"});
    let nullable = json!({"type":["string","null"]});
    let scope = if personal { "your own notes" } else { "this project's pages" };
    add("create", "command", true, &format!("Add a page to {scope}"), json!({"title": title, "body": doc, "parent": nullable, "icon": nullable}), vec!["title"]);
    add("get", "query", false, "One page with its body", json!({"id": id}), vec!["id"]);
    add("list", "query", false, &format!("The tree of {scope}, without bodies"), json!({}), vec![]);
    add("update", "command", true, "Change a page's title, body or icon", json!({"id": id, "title": title, "body": doc, "icon": nullable, "expected_rev": {"type":"integer","minimum":1}}), vec!["id"]);
    add("move", "command", true, "Move a page under another (or to the top), before a sibling", json!({"id": id, "parent": nullable, "before": nullable}), vec!["id"]);
    add("delete", "command", true, "Delete a page and everything under it", json!({"id": id}), vec!["id"]);
    add("versions", "query", false, "The saved earlier pictures of a page, newest first", json!({"id": id}), vec!["id"]);
    add("version", "query", false, "One earlier picture of a page, with its body", json!({"id": id, "version": id}), vec!["id", "version"]);
    add("restore", "command", true, "Put an earlier picture back", json!({"id": id, "version": id}), vec!["id", "version"]);
    add("search", "query", false, &format!("Find pages in {scope} by title"), json!({"q": {"type":"string","minLength":1,"maxLength":100}}), vec!["q"]);
    Value::Object(m)
}

pub struct Pages;
impl Plugin for Pages {
    fn manifest(&self) -> Manifest {
        let mut ops = ops_for("pages", false).as_object().cloned().unwrap();
        ops.extend(ops_for("notes", true).as_object().cloned().unwrap());
        manifest(json!({
            "id": "pages", "version": "0.1.0", "name": "Pages", "namespaces": ["pages", "notes"],
            "description": "A tree of rich-text pages: a project's knowledge base (pages.*) and your own notes (notes.*)",
            "requires": {"plugins": ["projects"], "capabilities": ["emit", "call"]},
            "provides": [{"extension_point": "search.source", "optional": true}],
            "data": {"collections": [PAGES, VERSIONS], "version": 1,
                     "indexes": [{"collection": PAGES, "field": "project"}, {"collection": PAGES, "field": "owner"}, {"collection": PAGES, "field": "parent"}, {"collection": VERSIONS, "field": "page"}]},
            "events": {"pages.created": {}, "pages.updated": {}, "pages.moved": {}, "pages.removed": {}},
            "operations": ops
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("search.source", |tx, i| {
            let q = text(&i, "q").to_string();
            let projects = tx.call("projects.list", json!({}))?;
            let me = tx.who().subject.clone();
            let mut items = vec![];
            let mut hit = |d: &Doc, kind: &str, project: Option<&Value>| {
                let body = richtext::text_of(&d.body["body"]);
                if let Some((score, snippet)) = crate::search::score(&q, text(&d.body, "title"), &body) {
                    items.push(json!({"kind": kind, "id": d.id, "title": d.body["title"], "snippet": snippet, "score": score,
                        "project": project.map(|p| p["id"].clone()).unwrap_or(Value::Null), "project_name": project.map(|p| p["name"].clone()).unwrap_or(Value::Null)}));
                }
            };
            for p in projects["projects"].as_array().cloned().unwrap_or_default() {
                for d in tx.query(PAGES, &Query::new().eq("project", text(&p, "id")).limit(2000))?.items {
                    hit(&d, "page", Some(&p));
                }
            }
            for d in tx.query(PAGES, &Query::new().eq("owner", me.as_str()).eq("project", Value::Null).limit(2000))?.items {
                hit(&d, "note", None);
            }
            items.sort_by(|a, b| b["score"].as_f64().partial_cmp(&a["score"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
            items.truncate(50);
            Ok(json!({"items": items}))
        });
        type H = fn(&mut Tx, &Value, bool) -> Result<Value>;
        let all: [(&str, H); 10] = [("versions", versions), ("version", version), ("restore", restore), ("create", create), ("get", read), ("list", list), ("update", update), ("move", move_page), ("delete", remove), ("search", search)];
        for (prefix, personal) in [("pages", false), ("notes", true)] {
            for (name, f) in all {
                b.op(&format!("{prefix}.{name}"), move |tx, i| f(tx, &i, personal));
            }
        }
    }
}
