//! `discussion`: comments with one level of replies, and updates (a note on a task that is not an edit).

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const COMMENTS: &str = "discussion.comments";

fn view(d: &Doc) -> Value {
    let b = &d.body;
    json!({"id": d.id, "rev": d.rev, "project": b["project"], "task": b["task"], "kind": b["kind"], "parent": b["parent"], "body": b["body"], "author": b["author"], "author_display": b["author_display"], "at": b["at"]})
}

pub struct Discussion;

impl Plugin for Discussion {
    fn manifest(&self) -> Manifest {
        let pr = json!({"type":"string"});
        manifest(json!({
            "id": "discussion", "version": "0.2.0", "name": "Discussion", "namespaces": ["discussion"],
            "description": "Comments with one level of replies, and updates",
            "requires": {"plugins": ["projects", "tasks"], "capabilities": ["emit", "call"]},
            "data": {"collections": [COMMENTS], "version": 1, "indexes": [{"collection": COMMENTS, "field": "task"}]},
            "events": {"discussion.added": {}, "discussion.removed": {}},
            "operations": {
                "discussion.add": {"kind": "command", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"discussion.bad_parent": "Replies go to a top-level comment of the same task"},
                    "input": {"type":"object","required":["project","task","body"],"properties":{"project":pr,"task":pr,"body":{"type":"string","minLength":1,"maxLength":5000},"kind":{"enum":["comment","update"]},"parent":{"type":["string","null"]}},"additionalProperties":false},
                    "output": {"type":"object","required":["id","body"]}},
                "discussion.list": {"kind": "query", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","task"],"properties":{"project":pr,"task":pr,"limit":{"type":"integer","minimum":1,"maximum":500}},"additionalProperties":false},
                    "output": {"type":"object","required":["comments"]}},
                "discussion.remove": {"kind": "command", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"discussion.not_yours": "Only the author or the project owner can remove a comment"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":pr,"id":pr},"additionalProperties":false}}
            },
            "listeners": [{"id": "discussion.cleanup", "on": ["tasks.removed", "projects.deleted"], "handler": "discussion.cleanup"}]
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.op("discussion.add", |tx, i| {
            let (project, task) = (text(&i, "project").to_string(), text(&i, "task").to_string());
            tx.call("tasks.get", json!({"project": project, "id": task}))?; // the task must be in this project
            let parent = i.get("parent").cloned().unwrap_or(Value::Null);
            if let Some(pid) = parent.as_str() {
                let ok = tx.get(COMMENTS, pid)?.is_some_and(|c| text(&c.body, "task") == task && c.body["parent"].is_null());
                if !ok {
                    return Err(Error::reason(Category::Invalid, "discussion.bad_parent", "Replies go to a top-level comment of the same task"));
                }
            }
            let me = tx.who().clone();
            let now = tx.now();
            let d = tx.create(COMMENTS, json!({"project": project, "task": task, "kind": i.get("kind").cloned().unwrap_or(json!("comment")), "parent": parent, "body": i["body"], "author": me.subject, "author_display": me.display, "at": now}))?;
            tx.emit("discussion.added", Audience::scope("projects.members", &project), json!({"project": project, "task": task, "comment": view(&d)}))?;
            Ok(view(&d))
        });
        b.op("discussion.list", |tx, i| {
            let (project, task) = (text(&i, "project").to_string(), text(&i, "task").to_string());
            tx.call("tasks.get", json!({"project": project, "id": task}))?;
            let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize;
            let page = tx.query(COMMENTS, &Query::new().eq("task", task.as_str()).asc("at").limit(limit))?;
            let me = tx.who().subject.clone();
            let manage = tx.call("projects.get", json!({"project": project}))?["can"].as_array().is_some_and(|c| c.iter().any(|x| x == "projects.manage"));
            let rows: Vec<Value> = page.items.iter().map(|d| {
                let mut v = view(d);
                v["can_remove"] = json!(manage || text(&d.body, "author") == me);
                v
            }).collect();
            Ok(json!({"comments": rows}))
        });
        b.op("discussion.remove", |tx, i| {
            let project = text(&i, "project").to_string();
            let c = tx.get(COMMENTS, text(&i, "id"))?.filter(|c| text(&c.body, "project") == project).ok_or_else(|| Error::not_found("comment"))?;
            let manage = tx.call("projects.get", json!({"project": project}))?["can"].as_array().is_some_and(|c| c.iter().any(|x| x == "projects.manage"));
            if !manage && text(&c.body, "author") != tx.who().subject {
                return Err(Error::reason(Category::Denied, "discussion.not_yours", "Only the author or the project owner can remove a comment"));
            }
            let replies = tx.query(COMMENTS, &Query::new().eq("parent", c.id.as_str()).limit(1000))?;
            for r in replies.items {
                tx.delete(COMMENTS, &r.id)?;
            }
            tx.delete(COMMENTS, &c.id)?;
            tx.emit("discussion.removed", Audience::scope("projects.members", &project), json!({"project": project, "task": c.body["task"], "comment": c.id}))?;
            Ok(json!({}))
        });
        b.listener("discussion.cleanup", |tx, d| {
            let (field, value) = match d.event.kind.as_str() {
                "tasks.removed" => {
                    let mut ids = vec![text(&d.event.data, "task").to_string()];
                    ids.extend(ids_of(&d.event.data["subtasks"]));
                    for id in ids {
                        purge(tx, "task", &id)?;
                    }
                    return Ok(());
                }
                _ => ("project", text(&d.event.data, "project").to_string()),
            };
            purge(tx, field, &value)
        });
    }
}

fn purge(tx: &mut Tx, field: &str, value: &str) -> Result<()> {
    loop {
        let page = tx.query(COMMENTS, &Query::new().eq(field, value).limit(200))?;
        if page.items.is_empty() {
            return Ok(());
        }
        for c in page.items {
            tx.delete(COMMENTS, &c.id)?;
        }
    }
}
