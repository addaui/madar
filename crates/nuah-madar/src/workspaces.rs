//! `workspaces`: an optional, personal way to group the projects you can see (ADR 0023).
//! The id `default` always exists without this plugin; this plugin lets a person add their own.

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const WORKSPACES: &str = "workspaces.workspaces";
pub const PLACEMENTS: &str = "workspaces.placements";

fn placement_id(person: &str, project: &str) -> String {
    format!("{person}:{project}")
}

fn mine(tx: &Tx, id: &str) -> Result<Doc> {
    let me = tx.who().subject.clone();
    tx.get(WORKSPACES, id)?.filter(|d| !d.deleted && text(&d.body, "owner") == me).ok_or_else(|| Error::not_found("workspace"))
}

pub struct Workspaces;
impl Plugin for Workspaces {
    fn manifest(&self) -> Manifest {
        let name = json!({"type":"string","minLength":1,"maxLength":60});
        manifest(json!({
            "id": "workspaces", "version": "0.1.0", "name": "Workspaces", "namespaces": ["workspaces"],
            "description": "Group the projects you can see into your own workspaces (work, personal, ...); off, everything is in one list",
            "requires": {"plugins": ["projects"], "capabilities": ["emit"]},
            "data": {"collections": [WORKSPACES, PLACEMENTS], "version": 1,
                     "indexes": [{"collection": WORKSPACES, "field": "owner"}, {"collection": PLACEMENTS, "field": "person"}, {"collection": PLACEMENTS, "field": "project"}, {"collection": PLACEMENTS, "field": "workspace"}]},
            "events": {"workspaces.changed": {}},
            "operations": {
                "workspaces.list": {"kind": "query", "description": "Your workspaces (the built-in default first) and where each project you see is placed",
                    "output": {"type":"object","required":["workspaces","placements"]}},
                "workspaces.create": {"kind": "command", "description": "Add a workspace of your own",
                    "input": {"type":"object","required":["name"],"properties":{"name":name},"additionalProperties":false}, "output": {"type":"object","required":["id","name"]}},
                "workspaces.rename": {"kind": "command", "description": "Rename one of your workspaces",
                    "input": {"type":"object","required":["id","name"],"properties":{"id":{"type":"string"},"name":name},"additionalProperties":false}},
                "workspaces.delete": {"kind": "command", "description": "Delete one of your workspaces; it must hold no project",
                    "reasons": {"workspaces.not_empty": "Move its projects elsewhere first"},
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}},
                "workspaces.place": {"kind": "command", "description": "Put a project you can see into one of your workspaces (or `default`)", "permission": "projects.read",
                    "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","workspace"],"properties":{"project":{"type":"string"},"workspace":{"type":"string"}},"additionalProperties":false}}
            },
            "listeners": [{"id": "workspaces.cleanup", "on": ["projects.deleted", "projects.unshared"], "handler": "workspaces.cleanup"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("workspaces.list", |tx, _| {
            let me = tx.who().subject.clone();
            let ws = tx.query(WORKSPACES, &Query::new().eq("owner", me.as_str()).asc("created_at").limit(200))?;
            let pl = tx.query(PLACEMENTS, &Query::new().eq("person", me.as_str()).limit(5000))?;
            let mut list = vec![json!({"id": "default", "name": "Default", "builtin": true})];
            list.extend(ws.items.iter().map(|d| json!({"id": d.id, "name": d.body["name"], "builtin": false})));
            Ok(json!({"workspaces": list, "placements": pl.items.iter().map(|d| json!({"project": d.body["project"], "workspace": d.body["workspace"]})).collect::<Vec<_>>()}))
        });
        b.op("workspaces.create", |tx, i| {
            let me = tx.who().subject.clone();
            if tx.count(WORKSPACES, &[Cond { field: "owner".into(), op: Cmp::Eq, value: json!(me) }])? >= 50 {
                return Err(Error::invalid("name", "you have 50 workspaces already"));
            }
            let now = tx.now();
            let d = tx.create(WORKSPACES, json!({"name": i["name"].as_str().unwrap_or("").trim(), "owner": me, "created_at": now}))?;
            tx.emit("workspaces.changed", Audience::subject(&me), json!({"workspace": d.id}))?;
            Ok(json!({"id": d.id, "name": d.body["name"]}))
        });
        b.op("workspaces.rename", |tx, i| {
            let w = mine(tx, text(&i, "id"))?;
            let mut body = w.body.clone();
            body["name"] = json!(text(&i, "name").trim());
            tx.put(WORKSPACES, &w.id, body, Expect::Rev(w.rev))?;
            let me = tx.who().subject.clone();
            tx.emit("workspaces.changed", Audience::subject(&me), json!({"workspace": w.id}))?;
            Ok(json!({}))
        });
        b.op("workspaces.delete", |tx, i| {
            let w = mine(tx, text(&i, "id"))?;
            let me = tx.who().subject.clone();
            let held = tx.count(PLACEMENTS, &[Cond { field: "person".into(), op: Cmp::Eq, value: json!(me) }, Cond { field: "workspace".into(), op: Cmp::Eq, value: json!(w.id) }])?;
            if held > 0 {
                return Err(Error::reason(Category::Conflict, "workspaces.not_empty", "Move its projects elsewhere first"));
            }
            tx.delete(WORKSPACES, &w.id)?;
            tx.emit("workspaces.changed", Audience::subject(&me), json!({"workspace": w.id}))?;
            Ok(json!({}))
        });
        b.op("workspaces.place", |tx, i| {
            let me = tx.who().subject.clone();
            let (project, ws) = (text(&i, "project").to_string(), text(&i, "workspace").to_string());
            let id = placement_id(&me, &project);
            if ws == "default" {
                tx.delete(PLACEMENTS, &id)?;
            } else {
                mine(tx, &ws)?;
                tx.put(PLACEMENTS, &id, json!({"person": me, "project": project, "workspace": ws}), Expect::Any)?;
            }
            tx.emit("workspaces.changed", Audience::subject(&me), json!({"project": project, "workspace": ws}))?;
            Ok(json!({}))
        });
        b.listener("workspaces.cleanup", |tx, d| {
            let project = text(&d.event.data, "project").to_string();
            if d.event.kind == "projects.unshared" {
                tx.delete(PLACEMENTS, &placement_id(text(&d.event.data, "subject"), &project))?;
                return Ok(());
            }
            loop {
                let page = tx.query(PLACEMENTS, &Query::new().eq("project", project.as_str()).limit(200))?;
                if page.items.is_empty() {
                    return Ok(());
                }
                for p in page.items {
                    tx.delete(PLACEMENTS, &p.id)?;
                }
            }
        });
    }
}
