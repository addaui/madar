//! `projects`: projects, their members and Access levels. It answers for the project [resource] and the
//! "project members" [Scope], so the Core (not the Faces) knows who may do what.
//! Design: https://docs.addaui.com/nuah/specs/madar-v2/

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

fn level_of(tx: &Tx, project: &str, subject: &str) -> Result<Option<String>> {
    Ok(tx.get(MEMBERS, &member_id(project, subject))?.map(|d| text(&d.body, "level").to_string()))
}

fn project_view(d: &Doc, level: &str) -> Value {
    json!({"id": d.id, "rev": d.rev, "name": d.body["name"], "statuses": d.body["statuses"], "created_by": d.body["created_by"], "level": level})
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

pub struct Projects;

impl Plugin for Projects {
    fn manifest(&self) -> Manifest {
        let status = json!({"type":"object","required":["id","name"],"properties":{"id":{"type":"string","minLength":1,"maxLength":40},"name":{"type":"string","minLength":1,"maxLength":60}},"additionalProperties":false});
        let statuses = json!({"type":"array","minItems":2,"maxItems":12,"items":status});
        let project_out = json!({"type":"object","required":["id","rev","name","statuses","level"]});
        manifest(json!({
            "id": "projects", "version": "0.2.0", "name": "Projects", "namespaces": ["projects"],
            "description": "Projects, their members and Access levels",
            "requires": {"capabilities": ["emit"]},
            "data": {"collections": [PROJECTS, MEMBERS], "version": 1,
                     "indexes": [{"collection": MEMBERS, "field": "subject"}, {"collection": MEMBERS, "field": "project"}]},
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
                    "input": {"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":100},"statuses":statuses},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.list": {"kind": "query", "description": "The projects you belong to",
                    "output": {"type":"object","required":["projects"]}, "affordances": {"type":"projects.project","id":"id","at":"projects"}},
                "projects.get": {"kind": "query", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.update": {"kind": "command", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                                        "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":100},"statuses":statuses,"expected_rev":{"type":"integer","minimum":1}},"additionalProperties":false},
                    "output": project_out, "affordances": {"type":"projects.project","id":"id"}},
                "projects.delete": {"kind": "command", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false}},
                "projects.share": {"kind": "command", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "reasons": {"projects.owner_fixed": "The owner's level cannot be changed"},
                    "input": {"type":"object","required":["project","subject","level"],"properties":{"project":{"type":"string"},"subject":{"type":"string","minLength":1,"maxLength":200},"level":{"enum":["editor","viewer"]}},"additionalProperties":false}},
                "projects.unshare": {"kind": "command", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.manage",
                    "reasons": {"projects.owner_fixed": "The owner cannot be removed"},
                    "input": {"type":"object","required":["project","subject"],"properties":{"project":{"type":"string"},"subject":{"type":"string"}},"additionalProperties":false}},
                "projects.leave": {"kind": "command", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "reasons": {"projects.owner_fixed": "The owner cannot leave"},
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false}},
                "projects.members": {"kind": "query", "resource": {"type":"projects.project","id":"project"}, "permission": "projects.read",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false},
                    "output": {"type":"object","required":["members"]}}
            },
            "listeners": [{"id": "projects.cleanup", "on": ["projects.deleted"], "handler": "projects.cleanup"}]
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.resource("projects.project", |db, who, id| {
            if !db.get(PROJECTS, id)?.is_some_and(|d| !d.deleted) {
                return Ok(None);
            }
            Ok(db.get(MEMBERS, &member_id(id, &who.subject))?.filter(|d| !d.deleted).map(|d| grants(text(&d.body, "level"))))
        });
        b.scope("projects.members", |db, id, subject| Ok(db.get(MEMBERS, &member_id(id, subject))?.is_some_and(|d| !d.deleted)));

        b.op("projects.create", |tx, i| {
            let statuses = i.get("statuses").cloned().unwrap_or_else(|| json!([{"id":"todo","name":"To do"},{"id":"doing","name":"Doing"},{"id":"done","name":"Done"}]));
            check_statuses(&statuses)?;
            let me = tx.who().subject.clone();
            let p = tx.create(PROJECTS, json!({"name": i["name"], "statuses": statuses, "created_by": me}))?;
            tx.put(MEMBERS, &member_id(&p.id, &me), json!({"project": p.id, "subject": me, "level": "owner", "display": tx.who().display}), Expect::Absent)?;
            tx.emit("projects.created", Audience::scope("projects.members", &p.id), json!({"project": p.id, "name": p.body["name"]}))?;
            Ok(project_view(&p, "owner"))
        });
        b.op("projects.list", |tx, _| {
            let me = tx.who().subject.clone();
            let mine = tx.query(MEMBERS, &Query::new().eq("subject", me.as_str()).limit(500))?;
            let mut out = vec![];
            for m in mine.items {
                if let Some(p) = tx.get(PROJECTS, text(&m.body, "project"))? {
                    out.push(project_view(&p, text(&m.body, "level")));
                }
            }
            out.sort_by(|a, b| text(a, "name").to_lowercase().cmp(&text(b, "name").to_lowercase()));
            Ok(json!({"projects": out}))
        });
        b.op("projects.get", |tx, i| {
            let id = text(&i, "project");
            let p = tx.get(PROJECTS, id)?.ok_or_else(|| Error::not_found("project"))?;
            let me = tx.who().subject.clone();
            let level = level_of(tx, id, &me)?.unwrap_or_default();
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
            if let Some(s) = i.get("statuses") {
                check_statuses(s)?;
                changes.insert("statuses".into(), json!([body["statuses"], s]));
                body["statuses"] = s.clone();
            }
            let d = tx.put(PROJECTS, id, body, Expect::Rev(p.rev))?;
            tx.emit("projects.updated", Audience::scope("projects.members", id), json!({"project": id, "changes": changes}))?;
            let me = tx.who().subject.clone();
            Ok(project_view(&d, &level_of(tx, id, &me)?.unwrap_or_default()))
        });
        b.op("projects.delete", |tx, i| {
            let id = text(&i, "project");
            tx.delete(PROJECTS, id)?;
            tx.emit("projects.deleted", Audience::scope("projects.members", id), json!({"project": id}))?;
            Ok(json!({}))
        });
        b.op("projects.share", |tx, i| {
            let (id, who, level) = (text(&i, "project"), text(&i, "subject"), text(&i, "level"));
            let mid = member_id(id, who);
            let existing = tx.get(MEMBERS, &mid)?;
            if existing.as_ref().is_some_and(|d| text(&d.body, "level") == "owner") {
                return Err(Error::reason(Category::Conflict, "projects.owner_fixed", "The owner's level cannot be changed"));
            }
            let expect = existing.as_ref().map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent);
            tx.put(MEMBERS, &mid, json!({"project": id, "subject": who, "level": level}), expect)?;
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
            let all = tx.query(MEMBERS, &Query::new().eq("project", id).asc("subject").limit(500))?;
            let rows: Vec<Value> = all.items.iter().map(|d| json!({"subject": d.body["subject"], "level": d.body["level"], "display": d.body["display"]})).collect();
            Ok(json!({"members": rows}))
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
