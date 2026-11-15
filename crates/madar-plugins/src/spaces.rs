// SPDX-License-Identifier: Apache-2.0
//! `spaces` ([ADR 0083], building [ADR 0049]): a Space is a group of projects with members and roles. A project is in exactly one
//! Space and takes its members from it. This plugin owns the Spaces and who is in them, and answers for the resource `spaces.space` and
//! the Scope `spaces.members`; `projects` reads its collections to work out a person's access to a project.
//!
//! Every person also has the **personal Space**, id `default`. It is not stored: it has one member, its person, and cannot be renamed,
//! shared or deleted.
//!
//! [ADR 0049]: https://docs.addaui.com/nuah/adr/0049-a-space-is-the-shared-unit-with-members-and-projects-inherit-them-it-replaces-workspaces/
//! [ADR 0083]: https://docs.addaui.com/nuah/adr/0083-the-space-is-built-as-a-plugin-with-three-roles-the-personal-space-is-implicit-and-projects-take-their-members-from-it/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const SPACES: &str = "spaces.spaces";
pub const SPACE_MEMBERS: &str = "spaces.members";
/// The id of every person's own Space.
pub const PERSONAL: &str = "default";
/// How many Spaces one person may create.
pub const MAX_SPACES: u64 = 20;

pub fn member_id(space: &str, subject: &str) -> String {
    format!("{space}:{subject}")
}

/// The role a person holds in a stored Space: `admin`, `member` or `viewer`; `None` when they are not in it or it does not exist.
fn role_with(get: &dyn Fn(&str, &str) -> Result<Option<Doc>>, space: &str, subject: &str) -> Result<Option<String>> {
    if get(SPACES, space)?.is_none_or(|d| d.deleted) {
        return Ok(None);
    }
    Ok(get(SPACE_MEMBERS, &member_id(space, subject))?.filter(|d| !d.deleted).map(|d| text(&d.body, "role").to_string()))
}

/// [`role_with`] for the read-only handle a resource or Scope gets.
pub fn role_in(db: &dyn DbRead, space: &str, subject: &str) -> Result<Option<String>> {
    role_with(&|c, i| db.get(c, i), space, subject)
}

/// [`role_with`] for an Operation.
pub fn role_in_tx(tx: &Tx, space: &str, subject: &str) -> Result<Option<String>> {
    role_with(&|c, i| tx.get(c, i), space, subject)
}

/// What a project's level is for a Space role: the Space's admin owns the project, a member edits it, a viewer reads it.
pub fn level_for(role: &str) -> &'static str {
    match role {
        "admin" => "owner",
        "member" => "editor",
        _ => "viewer",
    }
}

fn grants(role: &str) -> Vec<String> {
    let all: &[&str] = match role {
        "admin" => &["spaces.read", "spaces.write", "spaces.manage"],
        "member" => &["spaces.read", "spaces.write"],
        _ => &["spaces.read"],
    };
    all.iter().map(|s| s.to_string()).collect()
}

/// Is this Space a stored one the caller is in, with this role at least? (For the operations that name a Space as an input.)
fn require_role(tx: &Tx, space: &str, wants: &[&str]) -> Result<()> {
    let me = tx.who().subject.clone();
    match tx.get(SPACE_MEMBERS, &member_id(space, &me))? {
        Some(m) if tx.get(SPACES, space)?.is_some() && wants.contains(&text(&m.body, "role")) => Ok(()),
        Some(_) => Err(Error::denied("spaces.manage")),
        None => Err(Error::not_found("space")),
    }
}

fn admins(tx: &Tx, space: &str) -> Result<usize> {
    Ok(tx.query(SPACE_MEMBERS, &Query::new().eq("space", space).limit(500))?.items.iter().filter(|d| text(&d.body, "role") == "admin").count())
}

pub struct Spaces;

impl Plugin for Spaces {
    fn manifest(&self) -> Manifest {
        let name = json!({"type":"string","minLength":1,"maxLength":60});
        let role = json!({"enum":["admin","member","viewer"]});
        let space = json!({"type":"object","required":["space"],"properties":{"space":{"type":"string"}},"additionalProperties":false});
        let reasons = json!({
            "spaces.last_admin": "A Space keeps at least one admin; make someone else an admin first",
            "spaces.not_empty": "Move its projects elsewhere first",
            "spaces.too_many": "You have reached the number of Spaces one person may create",
            "spaces.no_such_person": "Nobody signs in under that name"
        });
        manifest(json!({
            "id": "@madar/spaces", "version": "0.1.0", "name": "Spaces", "namespaces": ["spaces"],
            "description": "Spaces: groups of projects with members and roles; every person also has their own",
            "requires": {"capabilities": ["emit"]},
            "data": {"collections": [SPACES, SPACE_MEMBERS], "reads": ["projects.projects"], "version": 1,
                     "indexes": [{"collection": SPACES, "field": "created_by"}, {"collection": SPACE_MEMBERS, "field": "subject"}, {"collection": SPACE_MEMBERS, "field": "space"}]},
            "permissions": {
                "spaces.create": {"description": "Start a Space", "default": ["admin", "member"]},
                "spaces.read": {"description": "See a Space and who is in it", "default": ["admin", "member", "viewer"]},
                "spaces.write": {"description": "Create and edit projects in a Space", "default": ["admin", "member"]},
                "spaces.manage": {"description": "Rename, share and delete a Space", "default": ["admin", "member"]}
            },
            "resources": ["spaces.space"], "scopes": ["spaces.members"],
            "events": {"spaces.created": {}, "spaces.updated": {}, "spaces.deleted": {}, "spaces.shared": {}, "spaces.unshared": {}},
            "operations": {
                "spaces.list": {"kind": "query", "description": "Your Spaces: your own first, then the ones you are in, with your role", "output": crate::schemas::spaces()},
                "spaces.create": {"kind": "command", "permission": "spaces.create", "description": "Start a Space; you become its admin", "reasons": reasons,
                    "input": {"type":"object","required":["name"],"properties":{"name":name},"additionalProperties":false}, "output": crate::schemas::space()},
                "spaces.rename": {"kind": "command", "permission": "spaces.manage", "resource": {"type":"spaces.space","id":"space"}, "description": "Rename a Space",
                    "input": {"type":"object","required":["space","name"],"properties":{"space":{"type":"string"},"name":name},"additionalProperties":false}, "output": crate::schemas::space()},
                "spaces.delete": {"kind": "command", "permission": "spaces.manage", "resource": {"type":"spaces.space","id":"space"}, "description": "Delete a Space; it must hold no project", "reasons": reasons,
                    "input": space, "output": crate::schemas::done()},
                "spaces.members": {"kind": "query", "permission": "spaces.read", "resource": {"type":"spaces.space","id":"space"}, "description": "Who is in a Space, and their role",
                    "input": space, "output": crate::schemas::space_members()},
                "spaces.share": {"kind": "command", "permission": "spaces.manage", "resource": {"type":"spaces.space","id":"space"}, "description": "Add someone to a Space, or change their role", "reasons": reasons,
                    "input": {"type":"object","required":["space","role"],"properties":{"space":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":200,"description":"The name the person signs in with"},"subject":{"type":"string","minLength":1,"maxLength":200,"description":"Their stable id, when you already have it"},"role":role},"additionalProperties":false},
                    "output": crate::schemas::done()},
                "spaces.unshare": {"kind": "command", "permission": "spaces.manage", "resource": {"type":"spaces.space","id":"space"}, "description": "Take someone out of a Space", "reasons": reasons,
                    "input": {"type":"object","required":["space","subject"],"properties":{"space":{"type":"string"},"subject":{"type":"string"}},"additionalProperties":false}, "output": crate::schemas::done()},
                "spaces.leave": {"kind": "command", "permission": "spaces.read", "resource": {"type":"spaces.space","id":"space"}, "description": "Leave a Space", "reasons": reasons,
                    "input": space, "output": crate::schemas::done()}
            }
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.resource("spaces.space", |db, who, id| {
            if id == PERSONAL {
                return Ok(None);
            }
            Ok(role_in(db, id, &who.subject)?.map(|r| grants(&r)))
        });
        b.scope("spaces.members", |db, id, subject| Ok(role_in(db, id, subject)?.is_some()));

        b.op("spaces.list", |tx, _| {
            let me = tx.who().subject.clone();
            let mut out = vec![json!({"id": PERSONAL, "name": "Default", "builtin": true, "role": "admin"})];
            let mut mine = vec![];
            for m in tx.query(SPACE_MEMBERS, &Query::new().eq("subject", me.as_str()).limit(500))?.items {
                if let Some(s) = tx.get(SPACES, text(&m.body, "space"))? {
                    mine.push(json!({"id": s.id, "name": s.body["name"], "builtin": false, "role": m.body["role"]}));
                }
            }
            mine.sort_by(|a, b| text(a, "name").to_lowercase().cmp(&text(b, "name").to_lowercase()));
            out.extend(mine);
            Ok(json!({"spaces": out}))
        });
        b.op("spaces.create", |tx, i| {
            let me = tx.who().subject.clone();
            if tx.count(SPACES, &[Cond { field: "created_by".into(), op: Cmp::Eq, value: json!(me) }])? >= MAX_SPACES {
                return Err(Error::reason(Category::Invalid, "spaces.too_many", "You have reached the number of Spaces one person may create"));
            }
            let s = tx.create(SPACES, json!({"name": i["name"], "created_by": me}))?;
            tx.put(SPACE_MEMBERS, &member_id(&s.id, &me), json!({"space": s.id, "subject": me, "role": "admin", "display": tx.who().display}), Expect::Absent)?;
            tx.emit("spaces.created", Audience::scope("spaces.members", &s.id), json!({"space": s.id, "name": s.body["name"]}))?;
            Ok(json!({"id": s.id, "name": s.body["name"], "builtin": false, "role": "admin"}))
        });
        b.op("spaces.rename", |tx, i| {
            let id = text(&i, "space");
            require_role(tx, id, &["admin"])?;
            let s = tx.get(SPACES, id)?.ok_or_else(|| Error::not_found("space"))?;
            let mut body = s.body.clone();
            body["name"] = i["name"].clone();
            tx.put(SPACES, id, body.clone(), Expect::Rev(s.rev))?;
            tx.emit("spaces.updated", Audience::scope("spaces.members", id), json!({"space": id, "name": body["name"]}))?;
            Ok(json!({"id": id, "name": body["name"], "builtin": false, "role": "admin"}))
        });
        b.op("spaces.delete", |tx, i| {
            let id = text(&i, "space");
            require_role(tx, id, &["admin"])?;
            if tx.count("projects.projects", &[Cond { field: "space".into(), op: Cmp::Eq, value: json!(id) }])? > 0 {
                return Err(Error::reason(Category::Conflict, "spaces.not_empty", "Move its projects elsewhere first"));
            }
            let members = tx.query(SPACE_MEMBERS, &Query::new().eq("space", id).limit(500))?.items;
            // the members are removed in this very request, so each is told directly instead of through the Scope
            for m in members {
                tx.emit("spaces.deleted", Audience::subject(text(&m.body, "subject")), json!({"space": id}))?;
                tx.delete(SPACE_MEMBERS, &m.id)?;
            }
            tx.delete(SPACES, id)?;
            Ok(json!({}))
        });
        b.op("spaces.members", |tx, i| {
            let id = text(&i, "space");
            let all = tx.query(SPACE_MEMBERS, &Query::new().eq("space", id).asc("subject").limit(500))?;
            let rows: Vec<Value> = all.items.iter().map(|d| json!({"subject": d.body["subject"], "role": d.body["role"], "display": d.body["display"]})).collect();
            Ok(json!({"members": rows}))
        });
        b.op("spaces.share", |tx, i| {
            let (id, role) = (text(&i, "space"), text(&i, "role"));
            require_role(tx, id, &["admin"])?;
            let (who, display) = match (i["name"].as_str(), i["subject"].as_str()) {
                (Some(name), _) => {
                    let p = tx.find_person(name)?.ok_or_else(|| Error::reason(Category::NotFound, "spaces.no_such_person", "Nobody signs in under that name"))?;
                    (p.subject, Some(p.display))
                }
                (None, Some(subject)) => (subject.to_string(), None),
                (None, None) => return Err(Error::invalid("name", "give the name of the person, or their subject")),
            };
            let mid = member_id(id, &who);
            let existing = tx.get(SPACE_MEMBERS, &mid)?;
            if existing.as_ref().is_some_and(|d| text(&d.body, "role") == "admin") && role != "admin" && admins(tx, id)? <= 1 {
                return Err(Error::reason(Category::Conflict, "spaces.last_admin", "A Space keeps at least one admin; make someone else an admin first"));
            }
            let expect = existing.as_ref().map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent);
            let display = display.or_else(|| existing.as_ref().and_then(|d| d.body["display"].as_str().map(String::from)));
            tx.put(SPACE_MEMBERS, &mid, json!({"space": id, "subject": who, "role": role, "display": display}), expect)?;
            tx.emit("spaces.shared", Audience::scope("spaces.members", id), json!({"space": id, "subject": who, "role": role, "by": tx.who().subject}))?;
            Ok(json!({}))
        });
        b.op("spaces.unshare", |tx, i| {
            let id = text(&i, "space");
            require_role(tx, id, &["admin"])?;
            remove(tx, id, text(&i, "subject"))
        });
        b.op("spaces.leave", |tx, i| {
            let me = tx.who().subject.clone();
            remove(tx, text(&i, "space"), &me)
        });
    }
}

fn remove(tx: &mut Tx, space: &str, subject: &str) -> Result<Value> {
    let mid = member_id(space, subject);
    let Some(m) = tx.get(SPACE_MEMBERS, &mid)? else { return Err(Error::not_found("member")) };
    if text(&m.body, "role") == "admin" && admins(tx, space)? <= 1 {
        return Err(Error::reason(Category::Conflict, "spaces.last_admin", "A Space keeps at least one admin; make someone else an admin first"));
    }
    tx.delete(SPACE_MEMBERS, &mid)?;
    let data = json!({"space": space, "subject": subject, "by": tx.who().subject});
    tx.emit("spaces.unshared", Audience::subject(subject), data.clone())?;
    tx.emit("spaces.unshared", Audience::scope("spaces.members", space), data)?;
    Ok(json!({}))
}
