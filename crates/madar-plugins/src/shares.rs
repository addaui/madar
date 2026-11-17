// SPDX-License-Identifier: Apache-2.0
//! `shares` ([ADR 0084]): a page, or the pages of a Space, shown to people who do not use the app.
//!
//! A **share** names what is shown (a page with or without the pages under it, or the project pages of a Space), who may read it (the
//! **audience**: anyone with the link, anyone with the link and a PIN, anyone signed in, or named people) and which **version** they
//! see: **live** (the pages as they are now) or **pinned** to a **release**, a copy of the pages made by "publish". Reading is by the
//! share's id (`/share/<id>`) or, for a Space, its subdomain. Everything shown is read-only.
//!
//! The reading Operations come twice: a public one (no sign-in, for `anyone` and `pin`) and a signed one (for `accounts` and `people`),
//! which share one implementation. An unsigned caller who meets an audience that needs an account is told so (`shares.sign_in`) and the
//! Face asks for the signed one.
//!
//! [ADR 0084]: https://docs.addaui.com/nuah/adr/0084-pages-and-spaces-are-shared-through-releases-with-an-audience-one-face-reads-them-at-share-paths-and-subdomains/

use crate::files::FILES;
use crate::pages::PAGES;
use crate::projects::PROJECTS;
use crate::spaces;
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const SHARES: &str = "shares.shares";
pub const RELEASES: &str = "shares.releases";
pub const SNAPS: &str = "shares.snapshots";
/// One document, `exposure`: an Admin allowed sharing from an instance with no sign-in (ADR 0085).
pub const CONFIG: &str = "shares.config";
const EXPOSURE: &str = "exposure";

/// Pages one share may hold, and releases kept per share.
const MAX_PAGES: usize = 2000;
const KEEP_RELEASES: i64 = 20;
const AUDIENCES: [&str; 4] = ["anyone", "pin", "accounts", "people"];
/// Names a Space's subdomain may not take.
const RESERVED: [&str; 18] = ["www", "app", "api", "admin", "console", "share", "mail", "static", "assets", "files", "faces", "link", "pulse", "docs", "help", "status", "blog", "web"];

/// Public sharing is safe when people sign in, or when an Admin has said the instance's address is for the owner alone (ADR 0085): with no sign-in
/// whoever reaches the server is the Owner, and a shared address is the app's address.
fn exposure_ok(tx: &Tx) -> Result<bool> {
    Ok(tx.has_accounts() || tx.get(CONFIG, EXPOSURE)?.is_some())
}

fn need_exposure(tx: &Tx) -> Result<()> {
    if exposure_ok(tx)? {
        return Ok(());
    }
    Err(Error::reason(Category::Conflict, "shares.no_sign_in", "This instance has no sign-in. Anyone who can open its address can also use the whole app as you. Turn on sign-in, or ask an administrator to allow sharing anyway."))
}

fn rel_key(share: &str, n: i64) -> String {
    format!("{share}:{n}")
}

fn valid_subdomain(s: &str) -> bool {
    (3..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !s.starts_with('-') && !s.ends_with('-') && !RESERVED.contains(&s)
}

/// One page as it is kept in a release and shown to a reader.
fn item_of(d: &Doc, project_name: Value) -> Value {
    let b = &d.body;
    json!({"page": d.id, "project": b["project"], "project_name": project_name, "parent": b["parent"], "title": b["title"], "icon": b["icon"], "position": b["position"],
           "folder": b.get("folder").cloned().unwrap_or(json!(false)), "body": b["body"], "settings": b.get("settings").cloned().unwrap_or_else(|| json!({})), "rev": d.rev})
}

/// The pages a share covers, as they are now.
fn collect_live(tx: &Tx, share: &Doc) -> Result<Vec<Value>> {
    let b = &share.body;
    let mut out: Vec<Value> = vec![];
    if text(b, "kind") == "page" {
        let project = b["project"].as_str();
        let owner = text(b, "created_by");
        let ok = |d: &Doc| match project {
            Some(p) => d.body["project"].as_str() == Some(p),
            None => d.body["project"].is_null() && text(&d.body, "owner") == owner,
        };
        let Some(root) = tx.get(PAGES, text(b, "page"))?.filter(|d| ok(d)) else { return Ok(out) };
        let mut root_item = item_of(&root, Value::Null);
        root_item["parent"] = Value::Null;
        out.push(root_item);
        if b["include_children"] == true {
            let mut queue = vec![root.id.clone()];
            while let Some(id) = queue.pop() {
                for c in tx.query(PAGES, &Query::new().eq("parent", id.as_str()).limit(500))?.items.into_iter().filter(|c| ok(c)) {
                    if out.len() >= MAX_PAGES {
                        return Ok(out);
                    }
                    queue.push(c.id.clone());
                    out.push(item_of(&c, Value::Null));
                }
            }
        }
    } else {
        for p in tx.query(PROJECTS, &Query::new().eq("space", text(b, "space")).limit(200))?.items {
            for d in tx.query(PAGES, &Query::new().eq("project", p.id.as_str()).limit(500))?.items {
                if out.len() >= MAX_PAGES {
                    return Ok(out);
                }
                out.push(item_of(&d, p.body["name"].clone()));
            }
        }
    }
    Ok(out)
}

/// A short fingerprint of which pages there are and which revision each is at.
fn sig(items: &[Value]) -> String {
    let mut lines: Vec<String> = items.iter().map(|i| format!("{}:{}", text(i, "page"), i["rev"])).collect();
    lines.sort();
    let mut h = Sha256::new();
    h.update(lines.join("\n").as_bytes());
    format!("{:x}", h.finalize())[..16].to_string()
}

fn pinned_items(tx: &Tx, share: &Doc) -> Result<Vec<Value>> {
    let n = share.body["release"].as_i64().unwrap_or(0);
    Ok(tx.query(SNAPS, &Query::new().eq("rel", rel_key(&share.id, n).as_str()).limit(MAX_PAGES))?.items.into_iter().map(|d| d.body["item"].clone()).collect())
}

/// What a reader sees: the pinned release, or the pages as they are now.
fn shown_items(tx: &Tx, share: &Doc) -> Result<Vec<Value>> {
    if text(&share.body, "mode") == "pinned" {
        pinned_items(tx, share)
    } else {
        collect_live(tx, share)
    }
}

fn latest_release(tx: &Tx, share: &str) -> Result<Option<Doc>> {
    Ok(tx.query(RELEASES, &Query::new().eq("share", share).desc("number").limit(1))?.items.into_iter().next())
}

/// Copy the pages as they are now into a new release and return its number.
fn publish(tx: &mut Tx, share: &Doc) -> Result<i64> {
    let items = collect_live(tx, share)?;
    let n = latest_release(tx, &share.id)?.map(|d| d.body["number"].as_i64().unwrap_or(0)).unwrap_or(0) + 1;
    let (me, now) = (tx.who().subject.clone(), tx.now());
    for it in &items {
        tx.put(SNAPS, &format!("{}:{}", rel_key(&share.id, n), text(it, "page")), json!({"share": share.id, "rel": rel_key(&share.id, n), "release": n, "item": it}), Expect::Absent)?;
    }
    tx.put(RELEASES, &rel_key(&share.id, n), json!({"share": share.id, "number": n, "at": now, "by": me, "count": items.len(), "sig": sig(&items)}), Expect::Absent)?;
    // only the last releases are kept, and never the one a share is pinned to
    let old = n - KEEP_RELEASES;
    if old > 0 && share.body["release"].as_i64() != Some(old) {
        drop_release(tx, &share.id, old)?;
    }
    Ok(n)
}

fn drop_release(tx: &mut Tx, share: &str, n: i64) -> Result<()> {
    loop {
        let page = tx.query(SNAPS, &Query::new().eq("rel", rel_key(share, n).as_str()).limit(200))?;
        if page.items.is_empty() {
            break;
        }
        for d in page.items {
            tx.delete(SNAPS, &d.id)?;
        }
    }
    tx.delete(RELEASES, &rel_key(share, n))?;
    Ok(())
}

fn find_share(tx: &Tx, i: &Value) -> Result<Doc> {
    let by_id = i["id"].as_str().and_then(|id| tx.get(SHARES, id).ok().flatten());
    if let Some(d) = by_id {
        return Ok(d);
    }
    if let Some(sub) = i["subdomain"].as_str() {
        if let Some(d) = tx.query(SHARES, &Query::new().eq("subdomain", sub).limit(1))?.items.into_iter().next() {
            return Ok(d);
        }
    }
    Err(Error::not_found("share"))
}

fn can_manage(tx: &Tx, share: &Doc) -> Result<bool> {
    let me = tx.who().subject.clone();
    if text(&share.body, "created_by") == me {
        return Ok(true);
    }
    Ok(text(&share.body, "kind") == "space" && spaces::role_in_tx(tx, text(&share.body, "space"), &me)?.as_deref() == Some("admin"))
}

fn manage(tx: &Tx, i: &Value) -> Result<Doc> {
    let share = find_share(tx, i)?;
    if can_manage(tx, &share)? {
        Ok(share)
    } else {
        Err(Error::not_found("share"))
    }
}

/// May this reader see the share? `who` is the signed-in subject, or `None` for a public call.
fn check_access(tx: &Tx, share: &Doc, who: Option<&str>, pin: Option<&str>) -> Result<()> {
    let b = &share.body;
    if let Some(s) = who {
        if text(b, "created_by") == s || (text(b, "kind") == "space" && spaces::role_in_tx(tx, text(b, "space"), s)?.as_deref() == Some("admin")) {
            return Ok(());
        }
    }
    match text(b, "audience") {
        "anyone" => Ok(()),
        "pin" => match pin {
            None | Some("") => Err(Error::reason(Category::Denied, "shares.pin_required", "This needs a PIN")),
            Some(p) if p == text(b, "pin") => Ok(()),
            Some(_) => Err(Error::reason(Category::Denied, "shares.bad_pin", "That PIN is not right")),
        },
        "accounts" => who.map(|_| ()).ok_or_else(|| Error::reason(Category::Denied, "shares.sign_in", "Sign in to read this")),
        _ => match who {
            None => Err(Error::reason(Category::Denied, "shares.sign_in", "Sign in to read this")),
            Some(s) if b["people"].as_array().is_some_and(|l| l.iter().any(|p| p["subject"] == s)) => Ok(()),
            Some(_) => Err(Error::reason(Category::Denied, "shares.not_for_you", "This was not shared with you")),
        },
    }
}

/// What the Face is told of a share it manages (the PIN included, so the person can pass it on).
fn view(d: &Doc, manager: bool) -> Value {
    let b = &d.body;
    let mut v = json!({"id": d.id, "kind": b["kind"], "title": b["title"], "audience": b["audience"], "mode": b["mode"], "release": b.get("release").cloned().unwrap_or(json!(0)),
        "include_children": b.get("include_children").cloned().unwrap_or(json!(false)), "page": b.get("page").cloned().unwrap_or(Value::Null), "project": b.get("project").cloned().unwrap_or(Value::Null),
        "space": b.get("space").cloned().unwrap_or(Value::Null), "subdomain": b.get("subdomain").cloned().unwrap_or(Value::Null), "created_at": b["created_at"], "created_by": b["created_by"],
        "people": b.get("people").cloned().unwrap_or_else(|| json!([])), "pin": Value::Null});
    if manager && text(b, "audience") == "pin" {
        v["pin"] = b["pin"].clone();
    }
    v
}

fn status_of(tx: &Tx, share: &Doc) -> Result<Value> {
    let latest = latest_release(tx, &share.id)?.map(|d| d.body["number"].as_i64().unwrap_or(0)).unwrap_or(0);
    let pinned = text(&share.body, "mode") == "pinned";
    let mut changed = 0usize;
    if pinned {
        let now: BTreeMap<String, i64> = collect_live(tx, share)?.iter().map(|i| (text(i, "page").to_string(), i["rev"].as_i64().unwrap_or(0))).collect();
        let was: BTreeMap<String, i64> = pinned_items(tx, share)?.iter().map(|i| (text(i, "page").to_string(), i["rev"].as_i64().unwrap_or(0))).collect();
        let keys: BTreeSet<&String> = now.keys().chain(was.keys()).collect();
        changed = keys.into_iter().filter(|k| now.get(*k) != was.get(*k)).count();
    }
    Ok(json!({"mode": share.body["mode"], "release": share.body.get("release").cloned().unwrap_or(json!(0)), "latest": latest, "current": changed == 0, "changed": changed}))
}

/// The audience part of a request: checked against what this instance can do, and made into what is stored.
fn audience_fields(tx: &Tx, i: &Value, keep: Option<&Value>) -> Result<(String, Value, Value)> {
    let audience = i["audience"].as_str().or_else(|| keep.and_then(|k| k["audience"].as_str())).unwrap_or("anyone").to_string();
    if !AUDIENCES.contains(&audience.as_str()) {
        return Err(Error::invalid("audience", "choose anyone, pin, accounts or people"));
    }
    if matches!(audience.as_str(), "accounts" | "people") && !tx.has_accounts() {
        return Err(Error::reason(Category::Invalid, "shares.no_accounts", "This instance has no accounts to sign in to; use a PIN instead"));
    }
    let pin = if audience == "pin" {
        let given = i["pin"].as_str().map(String::from).or_else(|| keep.and_then(|k| k["pin"].as_str().map(String::from)));
        let p = given.unwrap_or_else(|| {
            // ten characters from a hash of a fresh id, so the PIN is as unguessable as the id source is
            let mut h = Sha256::new();
            h.update(format!("{}:{}:{}", tx.new_id(), tx.who().subject, tx.now()).as_bytes());
            format!("{:x}", h.finalize())[..10].to_string()
        });
        if !(8..=64).contains(&p.chars().count()) {
            return Err(Error::invalid("pin", "a PIN has at least 8 characters"));
        }
        json!(p)
    } else {
        Value::Null
    };
    let people = if audience == "people" {
        if let Some(names) = i["people"].as_array() {
            let mut out = vec![];
            for n in names.iter().filter_map(|n| n.as_str()) {
                let p = tx.find_person(n)?.ok_or_else(|| Error::reason(Category::NotFound, "shares.no_such_person", &format!("Nobody signs in under the username {n}")))?;
                out.push(json!({"subject": p.subject, "display": p.display}));
            }
            json!(out)
        } else {
            keep.map(|k| k["people"].clone()).unwrap_or_else(|| json!([]))
        }
    } else {
        json!([])
    };
    Ok((audience, pin, people))
}

fn check_subdomain(tx: &Tx, sub: &str, except: &str) -> Result<()> {
    if !valid_subdomain(sub) {
        return Err(Error::reason(Category::Invalid, "shares.bad_subdomain", "Use 3 to 40 lowercase letters, digits and hyphens; some names are kept"));
    }
    if tx.query(SHARES, &Query::new().eq("subdomain", sub).limit(2))?.items.iter().any(|d| d.id != except) {
        return Err(Error::reason(Category::Conflict, "shares.subdomain_taken", "Another site already uses that name"));
    }
    Ok(())
}

/// What a reader gets: the tree, and one page with its body.
fn open_impl(tx: &mut Tx, i: &Value, signed: bool) -> Result<Value> {
    // an instance that went back to no sign-in without anyone allowing it does not go on serving what was shared
    if !exposure_ok(tx)? {
        return Err(Error::not_found("share"));
    }
    let share = find_share(tx, i)?;
    let who = signed.then(|| tx.who().subject.clone());
    check_access(tx, &share, who.as_deref(), i["pin"].as_str())?;
    let items = shown_items(tx, &share)?;
    // projects are told apart by a number, never by their id: a reader learns nothing of the instance
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    for it in &items {
        let k = it["project"].as_str().unwrap_or("").to_string();
        let n = groups.len();
        groups.entry(k).or_insert(n);
    }
    let mut tree: Vec<Value> = items.iter().map(|it| json!({"id": it["page"], "parent": it["parent"], "title": it["title"], "icon": it["icon"], "position": it["position"], "folder": it["folder"],
        "group": groups.get(it["project"].as_str().unwrap_or("")).copied().unwrap_or(0), "group_name": it["project_name"]})).collect();
    tree.sort_by(|a, b| (a["group"].as_u64(), a["position"].as_f64().map(|p| p as i64)).cmp(&(b["group"].as_u64(), b["position"].as_f64().map(|p| p as i64))));
    let want = i["page"].as_str();
    let chosen = match want {
        Some(id) => Some(items.iter().find(|it| it["page"] == id).ok_or_else(|| Error::not_found("page"))?),
        None if text(&share.body, "kind") == "page" => items.iter().find(|it| it["parent"].is_null()),
        None => None,
    };
    let page = chosen.map(|it| json!({"id": it["page"], "title": it["title"], "icon": it["icon"], "body": it["body"], "settings": it["settings"], "folder": it["folder"]}));
    // the font the page chose, with its faces, so a reader who is not signed in can draw it (ADR 0090); a page of a deployment with no font plugin has none
    let family = page.as_ref().and_then(|p| p["settings"]["font"].as_str()).map(|f| match f { "serif" => "fraunces", "mono" => "jetbrains-mono", other => other }.to_string());
    let fonts = family.and_then(|f| tx.call("fonts.families", json!({"ids": [f]})).ok()).map(|o| o["families"].clone()).unwrap_or_else(|| json!([]));
    Ok(json!({"share": {"id": share.id, "kind": share.body["kind"], "title": share.body["title"], "audience": share.body["audience"], "mode": share.body["mode"]}, "tree": tree, "page": page, "blocks": blocks_of(tx), "fonts": fonts}))
}

/// One uploaded file of a shared page, only when the shared pages use it.
fn file_impl(tx: &mut Tx, i: &Value, signed: bool) -> Result<Value> {
    if !exposure_ok(tx)? {
        return Err(Error::not_found("share"));
    }
    let share = find_share(tx, i)?;
    let who = signed.then(|| tx.who().subject.clone());
    check_access(tx, &share, who.as_deref(), i["pin"].as_str())?;
    let id = text(i, "file");
    let needle = format!("/files/{id}");
    let used = shown_items(tx, &share)?.iter().any(|it| it["body"].to_string().contains(&needle) || it["settings"].to_string().contains(&needle));
    let meta = tx.get(FILES, id)?.filter(|_| used).ok_or_else(|| Error::not_found("file"))?;
    let got = tx.extension_call("files.store", json!({"action": "get", "id": id}))?;
    Ok(json!({"name": meta.body["name"], "type": meta.body["type"], "size": meta.body["size"], "data": got["data"]}))
}

/// What the editor needs to draw the blocks plugins add (a reader has no sign-in to ask for them with), and nothing else.
fn blocks_of(tx: &mut Tx) -> Value {
    tx.call("editor.blocks", json!({})).ok().and_then(|b| b.get("blocks").cloned()).unwrap_or_else(|| json!([]))
}

pub struct Shares;

impl Plugin for Shares {
    fn manifest(&self) -> Manifest {
        let audience = json!({"enum": AUDIENCES});
        let mode = json!({"enum": ["pinned", "live"]});
        let people = json!({"type":"array","maxItems":50,"items":{"type":"string","minLength":1,"maxLength":200},"description":"The usernames people sign in with"});
        let pin = json!({"type":"string","minLength":8,"maxLength":64});
        let id = json!({"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false});
        let reasons = json!({
            "shares.no_accounts": "This instance has no accounts to sign in to; use a PIN instead",
            "shares.no_sign_in": "This instance has no sign-in, so sharing must be allowed by an administrator first",
            "shares.no_such_person": "Nobody signs in under that name",
            "shares.bad_subdomain": "Use 3 to 40 lowercase letters, digits and hyphens; some names are kept",
            "shares.subdomain_taken": "Another site already uses that name",
            "shares.exists": "This Space already has a site"
        });
        let read_reasons = json!({
            "shares.pin_required": "This needs a PIN", "shares.bad_pin": "That PIN is not right",
            "shares.sign_in": "Sign in to read this", "shares.not_for_you": "This was not shared with you"
        });
        let open_in = json!({"type":"object","properties":{"id":{"type":"string"},"subdomain":{"type":"string","maxLength":40},"page":{"type":"string"},"pin":{"type":"string","maxLength":64}},"additionalProperties":false});
        let file_in = json!({"type":"object","required":["file"],"properties":{"id":{"type":"string"},"subdomain":{"type":"string","maxLength":40},"file":{"type":"string"},"pin":{"type":"string","maxLength":64}},"additionalProperties":false});
        manifest(json!({
            "id": "@madar/shares", "version": "0.1.0", "name": "Sharing", "namespaces": ["shares"],
            "description": "Share a page, or a Space as a website, with anyone, people with a PIN, or people with an account; pinned to a release or kept live",
            "requires": {"plugins": ["@madar/pages", "@madar/spaces", "@madar/files"], "capabilities": ["call"], "extension_points": ["files.store"]},
            "settings_schema": {"type": "object", "additionalProperties": false, "properties": {
                "base_domain": {"type": "string", "maxLength": 100, "title": "Base domain for Space sites", "x-tier": "owner", "x-apply": "live",
                    "description": "A Space site is shown at <name>.<this domain>. The operator points *.<this domain> at the server and allows it in the web server's host names."}}},
            "data": {"collections": [SHARES, RELEASES, SNAPS, CONFIG], "reads": [PAGES, PROJECTS, FILES, spaces::SPACES, spaces::SPACE_MEMBERS], "version": 1,
                     "indexes": [{"collection": SHARES, "field": "page"}, {"collection": SHARES, "field": "space"}, {"collection": SHARES, "field": "subdomain"},
                                 {"collection": RELEASES, "field": "share"}, {"collection": SNAPS, "field": "rel"}]},
            "permissions": {"shares.create": {"description": "Share pages and manage your shares", "default": ["admin", "member"]},
                            "shares.read": {"description": "Read what was shared with the people who are signed in", "default": ["admin", "member", "viewer"]},
                            "shares.allow": {"description": "Allow or stop sharing from an instance that has no sign-in", "default": ["admin"]}},
            "operations": {
                "shares.options": {"kind": "query", "permission": "shares.create", "description": "What this instance can offer: whether people have accounts, and the base domain of Space sites", "output": crate::schemas::share_options()},
                "shares.acknowledge": {"kind": "command", "permission": "shares.allow", "description": "An Admin allows sharing from an instance with no sign-in, knowing that anyone who can open its address can use the whole app", "output": crate::schemas::done()},
                "shares.unacknowledge": {"kind": "command", "permission": "shares.allow", "description": "Stop allowing it; what was shared answers 'not found' until it is allowed again or sign-in is on", "output": crate::schemas::done()},
                "shares.list": {"kind": "query", "permission": "shares.create", "description": "The shares of a page you shared, or of a Space you administer",
                    "input": {"type":"object","properties":{"page":{"type":"string"},"space":{"type":"string"}},"additionalProperties":false}, "output": crate::schemas::shares()},
                "shares.create_page": {"kind": "command", "permission": "shares.create", "description": "Share a page you can read, with or without the pages under it", "reasons": reasons,
                    "input": {"type":"object","required":["page"],"properties":{"page":{"type":"string"},"project":{"type":"string"},"audience":audience,"pin":pin,"people":people,"mode":mode,"include_children":{"type":"boolean"}},"additionalProperties":false},
                    "output": crate::schemas::share()},
                "shares.create_space": {"kind": "command", "permission": "shares.create", "description": "Make a Space a website at a subdomain (a Space admin)", "reasons": reasons,
                    "input": {"type":"object","required":["space","subdomain"],"properties":{"space":{"type":"string"},"subdomain":{"type":"string","maxLength":40},"audience":audience,"pin":pin,"people":people,"mode":mode},"additionalProperties":false},
                    "output": crate::schemas::share()},
                "shares.update": {"kind": "command", "permission": "shares.create", "description": "Change who may read a share, whether it is pinned or live, or what it includes", "reasons": reasons,
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"},"audience":audience,"pin":pin,"people":people,"mode":mode,"include_children":{"type":"boolean"},"subdomain":{"type":"string","maxLength":40}},"additionalProperties":false},
                    "output": crate::schemas::share()},
                "shares.publish": {"kind": "command", "permission": "shares.create", "description": "Pin a share to a new release made now, or to an earlier release", "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"},"release":{"type":"integer","minimum":1}},"additionalProperties":false},
                    "output": crate::schemas::share()},
                "shares.revoke": {"kind": "command", "permission": "shares.create", "description": "Stop sharing: the link and its releases are gone", "input": id, "output": crate::schemas::done()},
                "shares.releases": {"kind": "query", "permission": "shares.create", "description": "The releases of a share, newest first", "input": id, "output": crate::schemas::share_releases()},
                "shares.space": {"kind": "query", "permission": "spaces.read", "resource": {"type":"spaces.space","id":"space"}, "description": "A Space's site and whether what it shows is the Space as it is now",
                    "input": {"type":"object","required":["space"],"properties":{"space":{"type":"string"}},"additionalProperties":false}, "output": crate::schemas::share_site()},
                "shares.open": {"kind": "query", "public": true, "description": "What a reader sees of a share that needs no account", "reasons": read_reasons, "input": open_in, "output": crate::schemas::share_opened()},
                "shares.open_signed": {"kind": "query", "permission": "shares.read", "description": "What a signed-in reader sees of a share", "reasons": read_reasons, "input": open_in, "output": crate::schemas::share_opened()},
                "shares.file": {"kind": "query", "public": true, "description": "A file of a shared page, with its type (the server turns this into /share-files/...)", "reasons": read_reasons, "input": file_in, "output": crate::schemas::share_file()},
                "shares.file_signed": {"kind": "query", "permission": "shares.read", "description": "A file of a shared page, for a signed-in reader", "reasons": read_reasons, "input": file_in, "output": crate::schemas::share_file()}
            },
            "listeners": [{"id": "shares.cleanup", "on": ["spaces.deleted"], "handler": "shares.cleanup"}]
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.op("shares.options", |tx, _| Ok(json!({"accounts": tx.has_accounts(), "public_ok": exposure_ok(tx)?, "acknowledged": tx.get(CONFIG, EXPOSURE)?.is_some(), "can_allow": tx.who().roles.iter().any(|r| r == "admin"), "base_domain": tx.settings().get("base_domain").cloned().filter(|v| v.as_str().is_some_and(|s| !s.is_empty())).unwrap_or(Value::Null)})));
        b.op("shares.acknowledge", |tx, _| {
            let (me, now) = (tx.who().subject.clone(), tx.now());
            tx.put(CONFIG, EXPOSURE, json!({"by": me, "at": now}), Expect::Any)?;
            Ok(json!({}))
        });
        b.op("shares.unacknowledge", |tx, _| {
            if tx.get(CONFIG, EXPOSURE)?.is_some() {
                tx.delete(CONFIG, EXPOSURE)?;
            }
            Ok(json!({}))
        });
        b.op("shares.list", |tx, i| {
            let me = tx.who().subject.clone();
            let mut found = vec![];
            if let Some(p) = i["page"].as_str() {
                found = tx.query(SHARES, &Query::new().eq("page", p).limit(50))?.items.into_iter().filter(|d| text(&d.body, "created_by") == me).collect();
            } else if let Some(s) = i["space"].as_str() {
                if spaces::role_in_tx(tx, s, &me)?.as_deref() == Some("admin") {
                    found = tx.query(SHARES, &Query::new().eq("space", s).limit(5))?.items;
                }
            }
            Ok(json!({"shares": found.iter().map(|d| view(d, true)).collect::<Vec<_>>()}))
        });
        b.op("shares.create_page", |tx, i| {
            need_exposure(tx)?;
            let page = text(&i, "page");
            let project = i["project"].as_str();
            // the person must be able to read the page: the page operations ask the policy as they would for the person
            let got = match project {
                Some(p) => tx.call("knowledge.get", json!({"project": p, "id": page}))?,
                None => tx.call("pages.get", json!({"id": page}))?,
            };
            let (audience, pin, people) = audience_fields(tx, &i, None)?;
            let mode = i["mode"].as_str().unwrap_or("pinned");
            let me = tx.who().subject.clone();
            let now = tx.now();
            let share = tx.create(SHARES, json!({"kind": "page", "title": got["title"], "page": page, "project": project, "audience": audience, "pin": pin, "people": people,
                "mode": mode, "release": 0, "include_children": i["include_children"] == true, "created_by": me, "created_at": now}))?;
            finish(tx, share)
        });
        b.op("shares.create_space", |tx, i| {
            need_exposure(tx)?;
            let (space, me) = (text(&i, "space"), tx.who().subject.clone());
            if spaces::role_in_tx(tx, space, &me)?.as_deref() != Some("admin") {
                return Err(Error::not_found("space"));
            }
            if tx.query(SHARES, &Query::new().eq("space", space).limit(1))?.items.first().is_some() {
                return Err(Error::reason(Category::Conflict, "shares.exists", "This Space already has a site"));
            }
            let sub = text(&i, "subdomain");
            check_subdomain(tx, sub, "")?;
            let (audience, pin, people) = audience_fields(tx, &i, None)?;
            let name = tx.get(spaces::SPACES, space)?.map(|s| s.body["name"].clone()).unwrap_or(Value::Null);
            let now = tx.now();
            let share = tx.create(SHARES, json!({"kind": "space", "title": name, "space": space, "subdomain": sub, "audience": audience, "pin": pin, "people": people,
                "mode": i["mode"].as_str().unwrap_or("pinned"), "release": 0, "include_children": true, "created_by": me, "created_at": now}))?;
            finish(tx, share)
        });
        b.op("shares.update", |tx, i| {
            need_exposure(tx)?;
            let share = manage(tx, &i)?;
            let mut body = share.body.clone();
            if i.get("audience").is_some() || i.get("pin").is_some() || i.get("people").is_some() {
                let (a, pin, people) = audience_fields(tx, &i, Some(&body))?;
                body["audience"] = json!(a);
                body["pin"] = pin;
                body["people"] = people;
            }
            if let Some(c) = i.get("include_children").and_then(|c| c.as_bool()) {
                if text(&body, "kind") == "page" {
                    body["include_children"] = json!(c);
                }
            }
            if let Some(sub) = i["subdomain"].as_str() {
                if text(&body, "kind") == "space" {
                    check_subdomain(tx, sub, &share.id)?;
                    body["subdomain"] = json!(sub);
                }
            }
            if let Some(m) = i["mode"].as_str() {
                body["mode"] = json!(m);
            }
            let d = tx.put(SHARES, &share.id, body, Expect::Rev(share.rev))?;
            finish(tx, d)
        });
        b.op("shares.publish", |tx, i| {
            let share = manage(tx, &i)?;
            let n = match i["release"].as_i64() {
                Some(n) => {
                    if tx.get(RELEASES, &rel_key(&share.id, n))?.is_none() {
                        return Err(Error::not_found("release"));
                    }
                    n
                }
                None => publish(tx, &share)?,
            };
            let mut body = share.body.clone();
            body["mode"] = json!("pinned");
            body["release"] = json!(n);
            let d = tx.put(SHARES, &share.id, body, Expect::Rev(share.rev))?;
            Ok(view(&d, true))
        });
        b.op("shares.revoke", |tx, i| {
            let share = manage(tx, &i)?;
            remove_share(tx, &share.id)?;
            Ok(json!({}))
        });
        b.op("shares.releases", |tx, i| {
            let share = manage(tx, &i)?;
            let rows = tx.query(RELEASES, &Query::new().eq("share", share.id.as_str()).desc("number").limit(100))?.items;
            Ok(json!({"releases": rows.iter().map(|d| json!({"number": d.body["number"], "at": d.body["at"], "by": d.body["by"], "count": d.body["count"], "current": d.body["number"] == share.body["release"] && text(&share.body, "mode") == "pinned"})).collect::<Vec<_>>()}))
        });
        b.op("shares.space", |tx, i| {
            let space = text(&i, "space");
            let me = tx.who().subject.clone();
            let Some(share) = tx.query(SHARES, &Query::new().eq("space", space).limit(1))?.items.into_iter().next() else { return Ok(json!({"share": null, "status": null})) };
            let admin = spaces::role_in_tx(tx, space, &me)?.as_deref() == Some("admin");
            let st = status_of(tx, &share)?;
            Ok(json!({"share": view(&share, admin), "status": st, "admin": admin}))
        });
        b.op("shares.open", |tx, i| open_impl(tx, &i, false));
        b.op("shares.open_signed", |tx, i| open_impl(tx, &i, true));
        b.op("shares.file", |tx, i| file_impl(tx, &i, false));
        b.op("shares.file_signed", |tx, i| file_impl(tx, &i, true));
        // a deleted Space takes its site with it (safe to repeat: each member is told, and the first delivery already removed it)
        b.listener("shares.cleanup", |tx, d| {
            let space = text(&d.event.data, "space");
            for s in tx.query(SHARES, &Query::new().eq("space", space).limit(5))?.items {
                remove_share(tx, &s.id)?;
            }
            Ok(())
        });
    }
}

/// A pinned share with no release yet gets its first one; the share is then ready to show.
fn finish(tx: &mut Tx, share: Doc) -> Result<Value> {
    let mut d = share;
    if text(&d.body, "mode") == "pinned" && d.body["release"].as_i64().unwrap_or(0) == 0 {
        let n = publish(tx, &d)?;
        let mut body = d.body.clone();
        body["release"] = json!(n);
        d = tx.put(SHARES, &d.id, body, Expect::Rev(d.rev))?;
    }
    Ok(view(&d, true))
}

fn remove_share(tx: &mut Tx, id: &str) -> Result<()> {
    for r in tx.query(RELEASES, &Query::new().eq("share", id).limit(200))?.items {
        drop_release(tx, id, r.body["number"].as_i64().unwrap_or(0))?;
    }
    tx.delete(SHARES, id)?;
    Ok(())
}
