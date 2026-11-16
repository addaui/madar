// SPDX-License-Identifier: Apache-2.0
//! `projects`: projects, their members and Access levels. It answers for the project [resource] and the
//! "project members" [Scope], so the Core (not the Faces) knows who may do what.
//! Design: https://docs.addaui.com/nuah/specs/madar-v2/

use crate::spaces::{self, PERSONAL, SPACE_MEMBERS};
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const PROJECTS: &str = "projects.projects";
pub const MEMBERS: &str = "projects.members";

fn grants(level: &str) -> Vec<String> {
    let all = match level {
        "owner" => vec!["projects.read", "projects.write", "projects.manage"],
        "editor" => vec!["projects.read", "projects.write"],
        _ => vec!["projects.read"],
    };
    all.into_iter().map(String::from).collect()
}

fn member_id(project: &str, subject: &str) -> String {
    format!("{project}:{subject}")
}

fn rank(level: &str) -> u8 {
    match level {
        "owner" => 3,
        "editor" => 2,
        "viewer" => 1,
        _ => 0,
    }
}

/// The larger of two levels; a person's access is what the project gives them or what its Space gives them, whichever is more.
fn best(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(x), Some(y)) => Some(if rank(&y) > rank(&x) { y } else { x }),
        (x, None) => x,
        (None, y) => y,
    }
}

/// The Space a project is in (`default`, the personal one, when it was never placed).
fn space_of(body: &Value) -> &str {
    body.get("space").and_then(|s| s.as_str()).filter(|s| !s.is_empty()).unwrap_or(PERSONAL)
}

/// What the project's Space gives this person (nothing for the personal Space: only the project's own rows count there).
fn space_level(db: &dyn DbRead, project: &Value, subject: &str) -> Result<Option<String>> {
    let space = space_of(project);
    if space == PERSONAL {
        return Ok(None);
    }
    Ok(spaces::role_in(db, space, subject)?.map(|r| spaces::level_for(&r).to_string()))
}

fn space_level_tx(tx: &Tx, project: &Value, subject: &str) -> Result<Option<String>> {
    let space = space_of(project);
    if space == PERSONAL {
        return Ok(None);
    }
    Ok(spaces::role_in_tx(tx, space, subject)?.map(|r| spaces::level_for(&r).to_string()))
}

/// The level this person has on the project, from its own member rows and from its Space.
fn effective_level(tx: &Tx, project: &Doc, subject: &str) -> Result<Option<String>> {
    Ok(best(level_of(tx, &project.id, subject)?, space_level_tx(tx, &project.body, subject)?))
}

fn level_of(tx: &Tx, project: &str, subject: &str) -> Result<Option<String>> {
    Ok(tx.get(MEMBERS, &member_id(project, subject))?.map(|d| text(&d.body, "level").to_string()))
}

fn project_view(d: &Doc, level: &str) -> Value {
    json!({"id": d.id, "rev": d.rev, "name": d.body["name"], "key": d.body.get("key").cloned().unwrap_or(Value::Null), "space": space_of(&d.body), "statuses": d.body["statuses"], "attributes": d.body.get("attributes").cloned().unwrap_or_else(|| json!([])), "created_by": d.body["created_by"], "level": level})
}

/// Is this key used by a project other than `except`?
fn key_taken(tx: &Tx, key: &str, except: &str) -> Result<bool> {
    Ok(tx.query(PROJECTS, &Query::new().eq("key", key).limit(3))?.items.iter().any(|d| d.id != except))
}
/// A key a person typed: well formed and free.
fn chosen_key(tx: &Tx, key: &str, except: &str) -> Result<String> {
    if !valid_key(key) {
        return Err(Error::invalid("key", "use 2 to 6 capital letters or digits, starting with a letter"));
    }
    if key_taken(tx, key, except)? {
        return Err(Error::reason(Category::Conflict, "projects.key_taken", "Another project already uses that key"));
    }
    Ok(key.to_string())
}
/// A key made from the name, with a number added when it clashes (MDR, MDR2, MDR3).
fn fresh_key(tx: &Tx, name: &str, except: &str) -> Result<String> {
    let base = project_key(name);
    let (mut k, mut n) = (base.clone(), 2);
    while key_taken(tx, &k, except)? {
        let suffix = n.to_string();
        k = format!("{}{}", &base[..base.len().min(6 - suffix.len())], suffix);
        n += 1;
    }
    Ok(k)
}

fn check_statuses(v: &Value) -> Result<()> {
    let list = v.as_array().cloned().unwrap_or_default();
    let mut seen = std::collections::BTreeSet::new();
    for (i, s) in list.iter().enumerate() {
        let id = text(s, "id");
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(Error::invalid(&format!("statuses[{i}].id"), "use letters, digits, - and _"));
        }
        if !seen.insert(id.to_string()) {
            return Err(Error::invalid(&format!("statuses[{i}].id"), "is used twice"));
        }
    }
    Ok(())
}

/// The custom attributes a project's tasks may carry (ADR 0024): unique lowercase keys, typed.
pub fn check_attributes(v: &Value) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for (n, a) in v.as_array().cloned().unwrap_or_default().iter().enumerate() {
        let key = text(a, "key");
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            return Err(Error::invalid(&format!("attributes[{n}].key"), "use lowercase letters, digits and _"));
        }
        if !seen.insert(key.to_string()) {
            return Err(Error::invalid(&format!("attributes[{n}].key"), "is used twice"));
        }
        let is_choice = text(a, "type") == "choice";
        let has = a["choices"].as_array().is_some_and(|c| !c.is_empty());
        if is_choice != has {
            return Err(Error::invalid(&format!("attributes[{n}].choices"), "a choice attribute needs choices, and only a choice attribute has them"));
        }
    }
    Ok(())
}

pub struct Projects;

impl Plugin for Projects {
    fn manifest(&self) -> Manifest {
        let status = json!({"type":"object","required":["id","name"],"properties":{"id":{"type":"string","minLength":1,"maxLength":40},"name":{"type":"string","minLength":1,"maxLength":60},"color":{"type":"string","maxLength":20}},"additionalProperties":false});
        let statuses = json!({"type":"array","minItems":2,"maxItems":12,"items":status});
        let attrs = json!({"type":"array","maxItems":30,"items":{"type":"object","required":["key","label","type"],"properties":{
            "key":{"type":"string","minLength":1,"maxLength":30},"label":{"type":"string","minLength":1,"maxLength":60},
            "type":{"enum":["text","number","date","boolean","choice"]},"choices":{"type":"array","maxItems":30,"items":{"type":"string","minLength":1,"maxLength":40}}},"additionalProperties":false}});
        let project_out = crate::schemas::project();
        manifest(json!({
            "id": "@madar/projects", "version": "0.3.0", "name": "Projects", "namespaces": ["projects"],
            "provides": [{"extension_point": "prefs.item", "optional": true}],
            "description": "Projects, their members and Access levels",
            "requires": {"plugins": ["@madar/spaces"], "capabilities": ["emit"]},
            "data": {"collections": [PROJECTS, MEMBERS], "reads": [spaces::SPACES, SPACE_MEMBERS], "version": 3,
                     "indexes": [{"collection": MEMBERS, "field": "subject"}, {"collection": MEMBERS, "field": "project"}, {"collection": PROJECTS, "field": "space"}]},
            "permissions": {
                "projects.create": {"description": "Start a project", "default": ["admin", "member"]},
                "projects.read": {"description": "See a project and everything in it", "default": ["admin", "member", "viewer"]},
                "projects.write": {"description": "Change the content of a project", "default": ["admin", "member"]},
                "projects.manage": {"description": "Rename, edit columns, share, delete", "default": ["admin", "member"]}
            },
            "resources": ["projects.project"], "scopes": ["projects.members"],
            "events": {
                "projects.created": {}, "projects.updated": {}, "projects.deleted": {},
                "projects.shared": {}, "projects.unshared": {}
            },
            "operations": {
                "projects.create": {"kind": "command", "permission": "projects.create",
                    "description": "Start a project; you become its owner",
                    "reasons": {"projects.key_taken": "Another project already uses that key"},
                    "input": {"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":100},"key":{"type":"string","maxLength":6},"space":{"type":"string","description":"The Space to start it in; yours when absent"},"statuses":statuses,"attributes":attrs},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.move": {"kind": "command", "description": "Move a project to another Space (or to your own, `default`)", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "reasons": {"projects.move_denied": "Moving needs the admin role in the Space it leaves and in the one it joins"},
                    "input": {"type":"object","required":["project","space"],"properties":{"project":{"type":"string"},"space":{"type":"string","minLength":1}},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.list": {"kind": "query", "description": "The projects you belong to",
                    "output": crate::schemas::projects(), "affordances": {"type":"projects.project","id":"id","at":"projects"}},
                "projects.get": {"kind": "query", "description": "One project", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.update": {"kind": "command", "description": "Rename a project or change its columns", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                                        "reasons": {"projects.key_taken": "Another project already uses that key"},
                                        "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":100},"key":{"type":"string","maxLength":6},"statuses":statuses,"attributes":attrs,"expected_rev":{"type":"integer","minimum":1}},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.delete": {"kind": "command", "output": {"type":"object"}, "description": "Delete a project and everything in it", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false}},
                "projects.share": {"kind": "command", "output": {"type":"object"}, "description": "Give someone access to a project", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "reasons": {"projects.owner_fixed": "The owner's level cannot be changed", "projects.no_such_person": "Nobody signs in under that username"},
                    "input": {"type":"object","required":["project","level"],"properties":{"project":{"type":"string"},"username":{"type":"string","minLength":1,"maxLength":200,"description":"The username the person signs in with"},"subject":{"type":"string","minLength":1,"maxLength":200,"description":"Their stable id, when you already have it"},"level":{"enum":["editor","viewer"]}},"additionalProperties":false}},
                "projects.unshare": {"kind": "command", "output": {"type":"object"}, "description": "Take someone's access away", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "reasons": {"projects.owner_fixed": "The owner cannot be removed"},
                    "input": {"type":"object","required":["project","subject"],"properties":{"project":{"type":"string"},"subject":{"type":"string"}},"additionalProperties":false}},
                "projects.leave": {"kind": "command", "output": {"type":"object"}, "description": "Leave a project you were shared into", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "reasons": {"projects.owner_fixed": "The owner cannot leave"},
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false}},
                "projects.members": {"kind": "query", "description": "Who is in a project, and their access", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false},
                    "output": crate::schemas::members()}
            },
            "listeners": [{"id": "projects.cleanup", "on": ["projects.deleted"], "handler": "projects.cleanup"}]
        }))
    }

    fn migrate(&self, from: u32, tx: &mut Tx) -> Result<()> {
        if from != 1 {
            return Ok(());
        }
        // version 2: every project gets a key made from its name
        let all = tx.query(PROJECTS, &Query::new().asc("name").limit(5000))?.items;
        for d in all.into_iter().filter(|d| d.body.get("key").is_none_or(|k| k.is_null())) {
            let key = fresh_key(tx, text(&d.body, "name"), &d.id)?;
            let mut body = d.body.clone();
            body["key"] = json!(key);
            tx.put(PROJECTS, &d.id, body, Expect::Rev(d.rev))?;
        }
        Ok(())
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("prefs.item", |_tx, _i| {
            Ok(nuah_prefs::pref_answer(vec![json!({"key": "projects.default_tab", "group": "behaviour", "type": "choice", "default": "board",
                "label": {"en": "Default project view", "ar": "العرض الافتراضي للمشروع"},
                "choices": [{"value":"board","label":{"en":"Board","ar":"اللوحة"}},{"value":"list","label":{"en":"List","ar":"القائمة"}},{"value":"overview","label":{"en":"Overview","ar":"نظرة عامة"}},{"value":"pages","label":{"en":"Pages","ar":"الصفحات"}}]})]))
        });
        b.resource("projects.project", |db, who, id| {
            let Some(p) = db.get(PROJECTS, id)?.filter(|d| !d.deleted) else { return Ok(None) };
            let direct = db.get(MEMBERS, &member_id(id, &who.subject))?.filter(|d| !d.deleted).map(|d| text(&d.body, "level").to_string());
            Ok(best(direct, space_level(db, &p.body, &who.subject)?).map(|l| grants(&l)))
        });
        b.scope("projects.members", |db, id, subject| {
            if db.get(MEMBERS, &member_id(id, subject))?.is_some_and(|d| !d.deleted) {
                return Ok(true);
            }
            let Some(p) = db.get(PROJECTS, id)?.filter(|d| !d.deleted) else { return Ok(false) };
            Ok(space_level(db, &p.body, subject)?.is_some())
        });

        b.op("projects.create", |tx, i| {
            let statuses = i.get("statuses").cloned().unwrap_or_else(|| json!([{"id":"todo","name":"To do"},{"id":"doing","name":"Doing"},{"id":"done","name":"Done"}]));
            check_statuses(&statuses)?;
            let me = tx.who().subject.clone();
            let attributes = i.get("attributes").cloned().unwrap_or_else(|| json!([]));
            check_attributes(&attributes)?;
            let key = match i.get("key").and_then(|k| k.as_str()) {
                Some(k) => chosen_key(tx, k, "")?,
                None => fresh_key(tx, text(&i, "name"), "")?,
            };
            let space = i.get("space").and_then(|x| x.as_str()).unwrap_or(PERSONAL).to_string();
            if space != PERSONAL && !matches!(spaces::role_in_tx(tx, &space, &me)?.as_deref(), Some("admin") | Some("member")) {
                return Err(Error::not_found("space"));
            }
            let p = tx.create(PROJECTS, json!({"name": i["name"], "key": key, "space": space, "statuses": statuses, "attributes": attributes, "created_by": me}))?;
            tx.put(MEMBERS, &member_id(&p.id, &me), json!({"project": p.id, "subject": me, "level": "owner", "display": tx.who().display}), Expect::Absent)?;
            tx.emit("projects.created", Audience::scope("projects.members", &p.id), json!({"project": p.id, "name": p.body["name"]}))?;
            Ok(project_view(&p, "owner"))
        });
        b.op("projects.list", |tx, _| {
            let me = tx.who().subject.clone();
            let mut found: std::collections::BTreeMap<String, Doc> = Default::default();
            for m in tx.query(MEMBERS, &Query::new().eq("subject", me.as_str()).limit(500))?.items {
                if let Some(p) = tx.get(PROJECTS, text(&m.body, "project"))? {
                    found.insert(p.id.clone(), p);
                }
            }
            // and every project in a Space the person is in
            for m in tx.query(SPACE_MEMBERS, &Query::new().eq("subject", me.as_str()).limit(500))?.items {
                for p in tx.query(PROJECTS, &Query::new().eq("space", text(&m.body, "space")).limit(1000))?.items {
                    found.entry(p.id.clone()).or_insert(p);
                }
            }
            let mut out = vec![];
            for p in found.values() {
                if let Some(level) = effective_level(tx, p, &me)? {
                    out.push(project_view(p, &level));
                }
            }
            out.sort_by(|a, b| text(a, "name").to_lowercase().cmp(&text(b, "name").to_lowercase()));
            Ok(json!({"projects": out}))
        });
        b.op("projects.get", |tx, i| {
            let id = text(&i, "project");
            let p = tx.get(PROJECTS, id)?.ok_or_else(|| Error::not_found("project"))?;
            let me = tx.who().subject.clone();
            let level = effective_level(tx, &p, &me)?.unwrap_or_default();
            Ok(project_view(&p, &level))
        });
        b.op("projects.update", |tx, i| {
            let id = text(&i, "project");
            let p = tx.get(PROJECTS, id)?.ok_or_else(|| Error::not_found("project"))?;
            if let Some(n) = i["expected_rev"].as_u64() {
                if n != p.rev {
                    return Err(Error::reason(Category::Conflict, "projects.stale_revision", "The project changed since you read it"));
                }
            }
            let mut body = p.body.clone();
            let mut changes = serde_json::Map::new();
            if let Some(n) = i.get("name") {
                changes.insert("name".into(), json!([body["name"], n]));
                body["name"] = n.clone();
            }
            if let Some(k) = i.get("key").and_then(|k| k.as_str()) {
                let k = chosen_key(tx, k, id)?;
                changes.insert("key".into(), json!([body.get("key").cloned().unwrap_or(Value::Null), k]));
                body["key"] = json!(k);
            }
            if let Some(s) = i.get("statuses") {
                check_statuses(s)?;
                changes.insert("statuses".into(), json!([body["statuses"], s]));
                body["statuses"] = s.clone();
            }
            if let Some(a) = i.get("attributes") {
                check_attributes(a)?;
                changes.insert("attributes".into(), json!([body.get("attributes").cloned().unwrap_or_else(|| json!([])), a]));
                body["attributes"] = a.clone();
            }
            let d = tx.put(PROJECTS, id, body, Expect::Rev(p.rev))?;
            tx.emit("projects.updated", Audience::scope("projects.members", id), json!({"project": id, "changes": changes}))?;
            let me = tx.who().subject.clone();
            Ok(project_view(&d, &effective_level(tx, &d, &me)?.unwrap_or_default()))
        });
        b.op("projects.move", |tx, i| {
            let (id, target) = (text(&i, "project"), text(&i, "space").to_string());
            let p = tx.get(PROJECTS, id)?.ok_or_else(|| Error::not_found("project"))?;
            let me = tx.who().subject.clone();
            let from = space_of(&p.body).to_string();
            if from == target {
                return Ok(project_view(&p, &effective_level(tx, &p, &me)?.unwrap_or_default()));
            }
            let denied = || Error::reason(Category::Denied, "projects.move_denied", "Moving needs the admin role in the Space it leaves and in the one it joins");
            let admin_of = |tx: &Tx, space: &str| -> Result<bool> { Ok(spaces::role_in_tx(tx, space, &me)?.as_deref() == Some("admin")) };
            // leaving a shared Space: its admin; joining one: its admin; becoming personal: a direct owner of the project
            if from != PERSONAL && !admin_of(tx, &from)? {
                return Err(denied());
            }
            if target == PERSONAL {
                if level_of(tx, id, &me)?.as_deref() != Some("owner") {
                    return Err(denied());
                }
            } else if spaces::role_in_tx(tx, &target, &me)?.is_none() {
                return Err(Error::not_found("space"));
            } else if !admin_of(tx, &target)? {
                return Err(denied());
            }
            let mut body = p.body.clone();
            body["space"] = json!(target);
            let d = tx.put(PROJECTS, id, body, Expect::Rev(p.rev))?;
            tx.emit("projects.updated", Audience::scope("projects.members", id), json!({"project": id, "changes": {"space": [from, target]}}))?;
            Ok(project_view(&d, &effective_level(tx, &d, &me)?.unwrap_or_default()))
        });
        b.op("projects.delete", |tx, i| {
            let id = text(&i, "project");
            tx.delete(PROJECTS, id)?;
            tx.emit("projects.deleted", Audience::scope("projects.members", id), json!({"project": id}))?;
            Ok(json!({}))
        });
        b.op("projects.share", |tx, i| {
            let (id, level) = (text(&i, "project"), text(&i, "level"));
            // The person is named by what they sign in with, or by the stable id the auth plugin gave them.
            let (who, display) = match (i["username"].as_str(), i["subject"].as_str()) {
                (Some(name), _) => {
                    let p = tx.find_person(name)?.ok_or_else(|| Error::reason(Category::NotFound, "projects.no_such_person", "Nobody signs in under that username"))?;
                    (p.subject, Some(p.display))
                }
                (None, Some(subject)) => (subject.to_string(), None),
                (None, None) => return Err(Error::invalid("username", "give the username of the person, or their subject")),
            };
            let who = who.as_str();
            let mid = member_id(id, who);
            let existing = tx.get(MEMBERS, &mid)?;
            if existing.as_ref().is_some_and(|d| text(&d.body, "level") == "owner") {
                return Err(Error::reason(Category::Conflict, "projects.owner_fixed", "The owner's level cannot be changed"));
            }
            let expect = existing.as_ref().map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent);
            tx.put(MEMBERS, &mid, json!({"project": id, "subject": who, "level": level, "display": display}), expect)?;
            tx.emit("projects.shared", Audience::scope("projects.members", id), json!({"project": id, "subject": who, "level": level, "by": tx.who().subject}))?;
            Ok(json!({}))
        });
        b.op("projects.unshare", |tx, i| remove_member(tx, text(&i, "project"), text(&i, "subject")));
        b.op("projects.leave", |tx, i| {
            let me = tx.who().subject.clone();
            remove_member(tx, text(&i, "project"), &me)
        });
        b.op("projects.members", |tx, i| {
            let id = text(&i, "project");
            let p = tx.get(PROJECTS, id)?.ok_or_else(|| Error::not_found("project"))?;
            let mut rows: std::collections::BTreeMap<String, Value> = Default::default();
            for d in tx.query(MEMBERS, &Query::new().eq("project", id).asc("subject").limit(500))?.items {
                rows.insert(text(&d.body, "subject").to_string(), json!({"subject": d.body["subject"], "level": d.body["level"], "display": d.body["display"], "via": "project"}));
            }
            // everyone in the project's Space is in the project too, at the level the Space gives (never lower than their own row)
            let space = space_of(&p.body);
            if space != PERSONAL {
                for m in tx.query(SPACE_MEMBERS, &Query::new().eq("space", space).limit(500))?.items {
                    let (who, level) = (text(&m.body, "subject").to_string(), spaces::level_for(text(&m.body, "role")));
                    match rows.get_mut(&who) {
                        Some(row) if rank(text(row, "level")) >= rank(level) => {}
                        Some(row) => {
                            row["level"] = json!(level);
                            row["via"] = json!("space");
                        }
                        None => {
                            rows.insert(who.clone(), json!({"subject": who, "level": level, "display": m.body["display"], "via": "space"}));
                        }
                    }
                }
            }
            Ok(json!({"members": rows.into_values().collect::<Vec<_>>()}))
        });
        b.listener("projects.cleanup", |tx, d| {
            let id = text(&d.event.data, "project");
            loop {
                let page = tx.query(MEMBERS, &Query::new().eq("project", id).limit(200))?;
                if page.items.is_empty() {
                    break;
                }
                for m in page.items {
                    tx.delete(MEMBERS, &m.id)?;
                }
            }
            Ok(())
        });
    }
}

fn remove_member(tx: &mut Tx, project: &str, subject: &str) -> Result<Value> {
    let mid = member_id(project, subject);
    let Some(m) = tx.get(MEMBERS, &mid)? else { return Err(Error::not_found("member")) };
    if text(&m.body, "level") == "owner" {
        return Err(Error::reason(Category::Conflict, "projects.owner_fixed", "The owner cannot be removed"));
    }
    tx.delete(MEMBERS, &mid)?;
    let data = json!({"project": project, "subject": subject, "by": tx.who().subject});
    // the person removed no longer belongs to the scope, so tell them directly too
    tx.emit("projects.unshared", Audience::subject(subject), data.clone())?;
    tx.emit("projects.unshared", Audience::scope("projects.members", project), data)?;
    Ok(json!({}))
}
