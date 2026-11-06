//! The small plugins: audit, quota, prefs, export, notify, the inbox provider, and the themes.

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// ---- audit ---------------------------------------------------------------------------------------

pub const ENTRIES: &str = "audit.entries";

pub struct Audit;
impl Plugin for Audit {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "audit", "version": "0.2.0", "name": "Audit", "namespaces": ["audit"],
            "description": "A history of everything that happened in a project, for its owners",
            "requires": {"plugins": ["projects"]},
            "data": {"collections": [ENTRIES], "version": 1, "indexes": [{"collection": ENTRIES, "field": "project"}]},
            "operations": {
                "audit.list": {"kind": "query", "description": "The history of a project (owners only)", "permission": "projects.manage", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":500},"after":{"type":"integer","minimum":0}},"additionalProperties":false},
                    "output": {"type":"object","required":["entries"]}}
            },
            "listeners": [{"id": "audit.record", "on": ["projects.*", "tasks.*", "discussion.*"], "handler": "audit.record"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("audit.list", |tx, i| {
            let page = tx.query(ENTRIES, &Query::new().eq("project", text(&i, "project")).desc("at").limit(i.get("limit").and_then(|l| l.as_u64()).unwrap_or(100) as usize).offset(i.get("after").and_then(|l| l.as_u64()).unwrap_or(0) as usize))?;
            let rows: Vec<Value> = page.items.iter().map(|d| json!({"id": d.id, "kind": d.body["kind"], "actor": d.body["actor"], "at": d.body["at"], "data": d.body["data"]})).collect();
            Ok(json!({"entries": rows, "next": page.next}))
        });
        // Safe to repeat: the entry's id comes from what was recorded, so a second delivery overwrites itself.
        b.listener("audit.record", |tx, d| {
            let project = text(&d.event.data, "project");
            if project.is_empty() {
                return Ok(());
            }
            if d.event.kind == "projects.deleted" {
                loop {
                    let page = tx.query(ENTRIES, &Query::new().eq("project", project).limit(200))?;
                    if page.items.is_empty() {
                        return Ok(());
                    }
                    for e in page.items {
                        tx.delete(ENTRIES, &e.id)?;
                    }
                }
            }
            let digest = format!("{:x}", Sha256::digest(d.event.data.to_string().as_bytes()));
            let id = format!("{:012}-{}-{}", d.seq, d.event.kind, &digest[..8]);
            tx.put(ENTRIES, &id, json!({"project": project, "kind": d.event.kind, "actor": d.actor, "at": d.at, "data": d.event.data}), Expect::Any)?;
            Ok(())
        });
    }
}

// ---- quota ---------------------------------------------------------------------------------------

pub struct Quota;
impl Plugin for Quota {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "quota", "version": "0.2.0", "name": "Quota", "namespaces": ["quota"],
            "description": "Limits how many tasks a project holds",
            "requires": {"plugins": ["tasks"]},
            "data": {"reads": ["tasks.tasks"]},
            "settings_schema": {"type":"object","properties":{"max_tasks":{"type":"integer","minimum":1,"maximum":1000000}},"additionalProperties":false},
            "hooks": [{"stage": "before", "on": "tasks.create", "order": 20, "handler": "quota.check", "reasons": {"quota.exceeded": "The project is full"}}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.before("quota.check", |tx, _op, input| {
            let max = tx.settings()["max_tasks"].as_u64().unwrap_or(1000);
            let n = tx.count("tasks.tasks", &[Cond { field: "project".into(), op: Cmp::Eq, value: json!(text(input, "project")) }, Cond { field: "archived".into(), op: Cmp::Eq, value: json!(false) }])?;
            if n >= max {
                return Err(Error::reason(Category::Conflict, "quota.exceeded", "This project is full").with_params(json!({"max": max})));
            }
            Ok(())
        });
    }
}

// ---- prefs ---------------------------------------------------------------------------------------

pub const PREFS: &str = "prefs.prefs";

pub struct Prefs;
impl Plugin for Prefs {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "prefs", "version": "0.2.0", "name": "Preferences", "namespaces": ["prefs"],
            "description": "Per-person choices: theme and language",
            "requires": {"capabilities": ["emit"]},
            "data": {"collections": [PREFS], "version": 1},
            "events": {"prefs.changed": {}},
            "operations": {
                "prefs.get": {"kind": "query", "description": "Your preferences", "output": {"type":"object","required":["theme","language"]}},
                "prefs.set": {"kind": "command", "description": "Change your preferences",
                    "input": {"type":"object","properties":{"theme":{"type":"string","minLength":1,"maxLength":40},"language":{"enum":["ar","en"]}},"additionalProperties":false},
                    "output": {"type":"object","required":["theme","language"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        fn read(tx: &Tx) -> Result<(Value, Option<u64>)> {
            let d = tx.get(PREFS, &tx.who().subject)?;
            Ok((d.as_ref().map(|d| d.body.clone()).unwrap_or_else(|| json!({"theme": "paper", "language": "en"})), d.map(|d| d.rev)))
        }
        b.op("prefs.get", |tx, _| Ok(read(tx)?.0));
        b.op("prefs.set", |tx, i| {
            let (mut body, rev) = read(tx)?;
            for k in ["theme", "language"] {
                if let Some(v) = i.get(k) {
                    body[k] = v.clone();
                }
            }
            let me = tx.who().subject.clone();
            tx.put(PREFS, &me, body.clone(), rev.map(Expect::Rev).unwrap_or(Expect::Absent))?;
            tx.emit("prefs.changed", Audience::subject(&me), body.clone())?;
            Ok(body)
        });
    }
}

// ---- export --------------------------------------------------------------------------------------

pub struct Export;
impl Plugin for Export {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "export", "version": "0.2.0", "name": "Export", "namespaces": ["export"],
            "description": "A whole project as one JSON document",
            "requires": {"plugins": ["projects", "tasks", "discussion"], "capabilities": ["call"]},
            "operations": {
                "export.project": {"kind": "query", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "description": "Download a project, its tasks, labels and comments",
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"}},"additionalProperties":false},
                    "output": {"type":"object","required":["project","tasks","labels","comments"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("export.project", |tx, i| {
            let project = text(&i, "project").to_string();
            let p = tx.call("projects.get", json!({"project": project}))?;
            let mut tasks = vec![];
            for archived in [false, true] {
                let mut after = 0u64;
                loop {
                    let page = tx.call("tasks.list", json!({"project": project, "archived": archived, "limit": 500, "after": after}))?;
                    tasks.extend(page["tasks"].as_array().cloned().unwrap_or_default());
                    match page["next"].as_u64() {
                        Some(n) => after = n,
                        None => break,
                    }
                }
            }
            let labels = tx.call("tasks.labels.list", json!({"project": project}))?["labels"].clone();
            let mut comments = vec![];
            for t in &tasks {
                let c = tx.call("discussion.list", json!({"project": project, "task": t["id"]}))?;
                comments.extend(c["comments"].as_array().cloned().unwrap_or_default());
            }
            Ok(json!({"exported_at": tx.now(), "project": {"id": p["id"], "name": p["name"], "statuses": p["statuses"]}, "tasks": tasks, "labels": labels, "comments": comments}))
        });
    }
}

// ---- notify and the inbox provider -----------------------------------------------------------------

pub struct Notify;
impl Plugin for Notify {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "notify", "version": "0.2.0", "name": "Notifications", "namespaces": ["notify"],
            "description": "Tells people when something is assigned to them or finished, through whatever fills notify.channel",
            "requires": {"extension_points": ["notify.channel"]},
            "defines": {"extension_points": {"notify.channel": {"policy": "many", "description": "A way to reach a person",
                "input": {"type":"object","required":["to","text"],"properties":{"to":{"type":"string"},"text":{"type":"string"},"link":{"type":"object"}}}}}},
            "listeners": [{"id": "notify.on_event", "on": ["tasks.assigned", "tasks.completed"], "handler": "notify.on_event"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.listener("notify.on_event", |tx, d| {
            let e = &d.event.data;
            let (to, text_) = match d.event.kind.as_str() {
                "tasks.assigned" if text(e, "assignee") != text(e, "by") => (text(e, "assignee").to_string(), format!("{} assigned you: {}", text(e, "by"), text(e, "title"))),
                "tasks.completed" if text(e, "created_by") != text(e, "by") => (text(e, "created_by").to_string(), format!("{} finished: {}", text(e, "by"), text(e, "title"))),
                _ => return Ok(()),
            };
            tx.extension_call("notify.channel", json!({"to": to, "text": text_, "link": {"project": e["project"], "task": e["task"]}}))?;
            Ok(())
        });
    }
}

pub const MESSAGES: &str = "inbox.messages";

pub struct NotifyInbox;
impl Plugin for NotifyInbox {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "notify-inbox", "version": "0.2.0", "name": "Inbox", "namespaces": ["inbox"],
            "description": "Keeps messages for each person to read in the app",
            "requires": {"plugins": ["notify"], "capabilities": ["emit"]},
            "provides": [{"extension_point": "notify.channel"}],
            "data": {"collections": [MESSAGES], "version": 1, "indexes": [{"collection": MESSAGES, "field": "to"}]},
            "events": {"inbox.received": {}},
            "operations": {
                "inbox.list": {"kind": "query", "description": "Your notifications", "input": {"type":"object","properties":{"unread":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":200}},"additionalProperties":false},
                    "output": {"type":"object","required":["messages","unread"]}},
                "inbox.read": {"kind": "command", "description": "Mark notifications as read", "input": {"type":"object","properties":{"id":{"type":"string"}},"additionalProperties":false}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("notify.channel", |tx, i| {
            let to = text(&i, "to").to_string();
            let now = tx.now();
            let d = tx.create(MESSAGES, json!({"to": to, "text": i["text"], "link": i["link"], "read": false, "at": now}))?;
            tx.emit("inbox.received", Audience::subject(&to), json!({"id": d.id, "text": i["text"], "link": i["link"]}))?;
            Ok(json!({"delivered": d.id}))
        });
        b.op("inbox.list", |tx, i| {
            let me = tx.who().subject.clone();
            let mut q = Query::new().eq("to", me.as_str());
            if i["unread"] == true {
                q = q.eq("read", false);
            }
            let page = tx.query(MESSAGES, &q.desc("at").limit(i.get("limit").and_then(|l| l.as_u64()).unwrap_or(50) as usize))?;
            let unread = tx.count(MESSAGES, &[Cond { field: "to".into(), op: Cmp::Eq, value: json!(me) }, Cond { field: "read".into(), op: Cmp::Eq, value: json!(false) }])?;
            let rows: Vec<Value> = page.items.iter().map(|d| json!({"id": d.id, "text": d.body["text"], "link": d.body["link"], "read": d.body["read"], "at": d.body["at"]})).collect();
            Ok(json!({"messages": rows, "unread": unread}))
        });
        b.op("inbox.read", |tx, i| {
            let me = tx.who().subject.clone();
            let page = match i.get("id").and_then(|x| x.as_str()) {
                Some(id) => tx.query(MESSAGES, &Query::new().eq("to", me.as_str()).eq("read", false).limit(500))?.items.into_iter().filter(|d| d.id == id).collect(),
                None => tx.query(MESSAGES, &Query::new().eq("to", me.as_str()).eq("read", false).limit(500))?.items,
            };
            for d in page {
                let mut body = d.body.clone();
                body["read"] = json!(true);
                tx.put(MESSAGES, &d.id, body, Expect::Rev(d.rev))?;
            }
            Ok(json!({}))
        });
    }
}

// ---- themes ----------------------------------------------------------------------------------------

pub struct Theme(pub &'static str, pub &'static str, pub Value);
impl Plugin for Theme {
    fn manifest(&self) -> Manifest {
        manifest(json!({"id": self.0, "version": "0.2.0", "name": self.1, "runtime": "data", "theme": self.2, "description": "Colours for Faces"}))
    }
}

pub fn themes() -> Vec<Theme> {
    vec![
        Theme("theme-paper", "Paper", json!({"scheme": "light", "bg": "#f6f4ef", "surface": "#ffffff", "text": "#1d1b16", "muted": "#6b675c", "accent": "#2f6f5e", "danger": "#b3402f"})),
        Theme("theme-ink", "Ink", json!({"scheme": "dark", "bg": "#14161a", "surface": "#1d2025", "text": "#e8e6e1", "muted": "#9a978e", "accent": "#6cc4a8", "danger": "#e07a68"})),
    ]
}
