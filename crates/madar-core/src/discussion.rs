//! `discussion`: comments with one level of replies, and updates (a note on a task that is not an edit).

use crate::content::richtext;
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const COMMENTS: &str = "discussion.comments";

fn view(d: &Doc) -> Value {
    let b = &d.body;
    json!({"id": d.id, "rev": d.rev, "project": b["project"], "task": b["task"], "page": b["page"], "kind": b["kind"], "parent": b["parent"], "body": b["body"],
           "author": b["author"], "author_display": b["author_display"], "at": b["at"],
           "reply_count": b.get("reply_count").cloned().unwrap_or(json!(0)), "last_reply_at": b.get("last_reply_at").cloned().unwrap_or(Value::Null),
           "participants": b.get("participants").cloned().unwrap_or_else(|| json!([]))})
}

/// Comments belong to a task or to a page: `("task", id)` or `("page", id)`.
fn target(i: &Value) -> Result<(&'static str, String)> {
    match (i.get("task").and_then(|t| t.as_str()), i.get("page").and_then(|t| t.as_str())) {
        (Some(t), None) => Ok(("task", t.to_string())),
        (None, Some(p)) => Ok(("page", p.to_string())),
        _ => Err(Error::invalid("task", "give either a task or a page")),
    }
}

fn check_target(tx: &mut Tx, project: &str, kind: &str, id: &str) -> Result<()> {
    if kind == "task" {
        tx.call("tasks.get", json!({"project": project, "id": id}))?;
    } else {
        tx.call("pages.get", json!({"project": project, "id": id}))?;
    }
    Ok(())
}

fn check_body(v: &Value) -> Result<()> {
    match v {
        Value::String(s) if !s.trim().is_empty() && s.len() <= 5000 => Ok(()),
        Value::Object(_) if v.to_string().len() <= 100_000 => crate::content::richtext::check("body", v),
        _ => Err(Error::invalid("body", "write some text (up to 5000 characters) or give a rich-text document")),
    }
}

pub struct Discussion;

impl Plugin for Discussion {
    fn manifest(&self) -> Manifest {
        let pr = json!({"type":"string"});
        manifest(json!({
            "id": "discussion", "version": "0.3.0", "name": "Discussion", "namespaces": ["discussion"],
            "description": "Comments on tasks and pages with threads (one level of replies), and updates",
            "provides": [{"extension_point": "timeline.source", "optional": true}],
            "requires": {"plugins": ["projects", "tasks"], "capabilities": ["emit", "call"]},
            "data": {"collections": [COMMENTS], "version": 1, "indexes": [{"collection": COMMENTS, "field": "task"}, {"collection": COMMENTS, "field": "page"}]},
            "events": {"discussion.added": {}, "discussion.removed": {}},
            "operations": {
                "discussion.add": {"kind": "command", "description": "Write a comment or an update on a task", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"discussion.bad_parent": "Replies go to a top-level comment of the same task"},
                    "input": {"type":"object","required":["project","body"],"properties":{"project":pr,"task":pr,"page":pr,"body":{"type":["string","object"]},"kind":{"enum":["comment","update"]},"parent":{"type":["string","null"]}},"additionalProperties":false},
                    "output": {"type":"object","required":["id","body"]}},
                "discussion.list": {"kind": "query", "description": "The comments on a task or page; roots only with roots=true, or the replies of one thread with parent", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":pr,"task":pr,"page":pr,"roots":{"type":"boolean"},"parent":pr,"before":{"type":"integer"},"limit":{"type":"integer","minimum":1,"maximum":500}},"additionalProperties":false},
                    "output": {"type":"object","required":["comments"]}},
                "discussion.remove": {"kind": "command", "description": "Remove a comment (its author or the project's owner)", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"discussion.not_yours": "Only the author or the project owner can remove a comment"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":pr,"id":pr},"additionalProperties":false}}
            },
            "listeners": [{"id": "discussion.cleanup", "on": ["tasks.removed", "projects.deleted", "pages.*"], "handler": "discussion.cleanup"}]
        }))
    }

    fn bind(&self, b: &mut Bindings) {
        b.op("discussion.add", |tx, i| {
            let project = text(&i, "project").to_string();
            let (kind, tid) = target(&i)?;
            check_target(tx, &project, kind, &tid)?; // the task or page must be in this project
            check_body(&i["body"])?;
            let parent = i.get("parent").cloned().unwrap_or(Value::Null);
            let mut root: Option<Doc> = None;
            if let Some(pid) = parent.as_str() {
                root = tx.get(COMMENTS, pid)?.filter(|c| text(&c.body, kind) == tid && c.body["parent"].is_null());
                if root.is_none() {
                    return Err(Error::reason(Category::Invalid, "discussion.bad_parent", "Replies go to a top-level comment of the same task or page"));
                }
            }
            let me = tx.who().clone();
            let now = tx.now();
            let d = tx.create(COMMENTS, json!({"project": project, kind: tid, "kind": i.get("kind").cloned().unwrap_or(json!("comment")), "parent": parent, "body": i["body"],
                "author": me.subject, "author_display": me.display, "at": now, "reply_count": 0, "participants": []}))?;
            if let Some(r) = root {
                let mut rb = r.body.clone();
                rb["reply_count"] = json!(rb["reply_count"].as_u64().unwrap_or(0) + 1);
                rb["last_reply_at"] = json!(now);
                let mut who_ = ids_of(&rb["participants"]);
                if !who_.contains(&me.subject) && who_.len() < 10 {
                    who_.push(me.subject.clone());
                }
                rb["participants"] = json!(who_);
                tx.put(COMMENTS, &r.id, rb, Expect::Rev(r.rev))?;
            }
            let body_doc = if i["body"].is_object() { i["body"].clone() } else { Value::Null };
            let links = richtext::refs_for("discussion.comment", &d.id, "", &body_doc);
            tx.emit("discussion.added", Audience::scope("projects.members", &project), json!({"project": project, kind: tid, "comment": view(&d), "refs": links}))?;
            tx.metrics().inc("madar_comments_added_total", &[], 1.0);
            Ok(view(&d))
        });
        b.op("discussion.list", |tx, i| {
            let project = text(&i, "project").to_string();
            let (kind, tid) = target(&i)?;
            check_target(tx, &project, kind, &tid)?;
            let limit = i.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize;
            let mut q = Query::new().eq(kind, tid.as_str());
            if i["roots"] == true {
                q = q.eq("parent", Value::Null);
            }
            if let Some(p) = i.get("parent").and_then(|p| p.as_str()) {
                q = q.eq("parent", p);
            }
            if let Some(b) = i.get("before").and_then(|b| b.as_i64()) {
                q = q.lt("at", b);
            }
            let page = tx.query(COMMENTS, &q.asc("at").limit(limit))?;
            let me = tx.who().subject.clone();
            let manage = tx.call("projects.get", json!({"project": project}))?["can"].as_array().is_some_and(|c| c.iter().any(|x| x == "projects.manage"));
            let rows: Vec<Value> = page.items.iter().map(|d| {
                let mut v = view(d);
                v["can_remove"] = json!(manage || text(&d.body, "author") == me);
                v
            }).collect();
            Ok(json!({"comments": rows}))
        });
        // The timeline asks every source for its newest items before a moment (ADR 0024).
        b.provide("timeline.source", |tx, i| {
            let (project, tt, id) = (text(&i, "project"), text(&i["target"], "type"), text(&i["target"], "id"));
            let field = match tt { "tasks.task" => "task", "pages.page" => "page", _ => return Ok(json!({"items": []})) };
            let before = i["before"].as_i64().unwrap_or(i64::MAX);
            let page = tx.query(COMMENTS, &Query::new().eq(field, id).eq("project", project).eq("parent", Value::Null).lt("at", before).desc("at").limit(i["limit"].as_u64().unwrap_or(30) as usize))?;
            Ok(json!({"items": page.items.iter().map(|d| json!({"at": d.body["at"], "source": "discussion", "kind": d.body["kind"], "id": d.id, "actor": d.body["author"],
                "actor_display": d.body["author_display"], "body": d.body["body"], "reply_count": d.body.get("reply_count").cloned().unwrap_or(json!(0)),
                "participants": d.body.get("participants").cloned().unwrap_or_else(|| json!([]))})).collect::<Vec<_>>()}))
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
            if let Some(pid) = c.body["parent"].as_str() {
                if let Some(root) = tx.get(COMMENTS, pid)? {
                    let mut rb = root.body.clone();
                    rb["reply_count"] = json!(rb["reply_count"].as_u64().unwrap_or(1).saturating_sub(1));
                    tx.put(COMMENTS, &root.id, rb, Expect::Rev(root.rev))?;
                }
            }
            tx.delete(COMMENTS, &c.id)?;
            tx.emit("discussion.removed", Audience::scope("projects.members", &project), json!({"project": project, "task": c.body["task"], "page": c.body["page"], "comment": c.id,
                "refs": richtext::refs_for("discussion.comment", &c.id, "", &Value::Null)}))?;
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
                "pages.removed" => ("page", text(&d.event.data, "page").to_string()),
                "projects.deleted" => ("project", text(&d.event.data, "project").to_string()),
                _ => return Ok(()),
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
