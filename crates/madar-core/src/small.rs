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
            "provides": [{"extension_point": "timeline.source", "optional": true}],
            "data": {"collections": [ENTRIES], "version": 1, "indexes": [{"collection": ENTRIES, "field": "project"}]},
            "operations": {
                "audit.list": {"kind": "query", "description": "The history of a project (owners only)", "permission": "projects.manage", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":500},"after":{"type":"integer","minimum":0}},"additionalProperties":false},
                    "output": {"type":"object","required":["entries"]}}
            },
            "listeners": [{"id": "audit.record", "on": ["projects.*", "tasks.*", "discussion.*", "pages.*"], "handler": "audit.record"}]
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("audit.list", |tx, i| {
            let page = tx.query(ENTRIES, &Query::new().eq("project", text(&i, "project")).desc("at").limit(i.get("limit").and_then(|l| l.as_u64()).unwrap_or(100) as usize).offset(i.get("after").and_then(|l| l.as_u64()).unwrap_or(0) as usize))?;
            let rows: Vec<Value> = page.items.iter().map(|d| json!({"id": d.id, "kind": d.body["kind"], "actor": d.body["actor"], "at": d.body["at"], "data": d.body["data"]})).collect();
            Ok(json!({"entries": rows, "next": page.next}))
        });
        // History about one task or page, for the project's owners only (the timeline tells us who asks).
        b.provide("timeline.source", |tx, i| {
            if i["manage"] != true {
                return Ok(json!({"items": []}));
            }
            let (project, tt, id) = (text(&i, "project"), text(&i["target"], "type"), text(&i["target"], "id"));
            let field = match tt { "tasks.task" => "task", "pages.page" => "page", _ => return Ok(json!({"items": []})) };
            let before = i["before"].as_i64().unwrap_or(i64::MAX);
            let page = tx.query(ENTRIES, &Query::new().eq("project", project).limit(5000))?;
            let mut items: Vec<Value> = page.items.iter().filter(|d| {
                let t = &d.body["data"][field];
                (t.as_str() == Some(id) || t["id"].as_str() == Some(id)) && d.body["at"].as_i64().unwrap_or(0) < before
                    && !text(&d.body, "kind").starts_with("discussion.") // comments are shown as themselves
            }).map(|d| json!({"at": d.body["at"], "source": "audit", "kind": d.body["kind"], "id": d.id, "actor": d.body["actor"], "data": d.body["data"]})).collect();
            items.sort_by(|a, b| b["at"].as_i64().cmp(&a["at"].as_i64()));
            items.truncate(i["limit"].as_u64().unwrap_or(30) as usize);
            Ok(json!({"items": items}))
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
            // Autosave edits one page many times a minute: one entry per person, page and ten minutes (ADR 0025).
            if d.event.kind == "pages.updated" {
                let id = format!("{:012}-pages.updated-{}-{}", d.at / 600_000, text(&d.event.data, "page"), &format!("{:x}", Sha256::digest(d.actor.as_bytes()))[..8]);
                let mut data = d.event.data.clone();
                if let Some(old) = tx.get(ENTRIES, &id)? {
                    let mut ch = old.body["data"]["changes"].as_object().cloned().unwrap_or_default();
                    for (k, v) in data["changes"].as_object().cloned().unwrap_or_default() { ch.insert(k, v); }
                    data["changes"] = Value::Object(ch);
                }
                tx.put(ENTRIES, &id, json!({"project": project, "kind": d.event.kind, "actor": d.actor, "at": d.at, "data": data}), Expect::Any)?;
                return Ok(());
            }
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
// ADR 0021: the plugin knows no preference itself. Every plugin that owns one provides `prefs.item`
// (optionally, so it still runs when this plugin is off); this plugin stores and checks the choices.

pub const PREFS: &str = "prefs.prefs";

fn lbl(en: &str, ar: &str) -> Value {
    json!({"en": en, "ar": ar})
}

fn choices(list: &[(&str, &str, &str)]) -> Value {
    Value::Array(list.iter().map(|(v, en, ar)| json!({"value": v, "label": lbl(en, ar)})).collect())
}

/// What a plugin answers when `prefs.item` is called.
pub fn pref_answer(items: Vec<Value>) -> Value {
    json!({ "items": items })
}

pub struct Prefs;
impl Plugin for Prefs {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "prefs", "version": "0.3.0", "name": "Preferences", "namespaces": ["prefs"],
            "description": "Per-person choices; each plugin declares its own (prefs.item) and this one stores and checks them",
            "requires": {"capabilities": ["emit"], "extension_points": ["prefs.item"]},
            "defines": {"extension_points": {"prefs.item": {"policy": "many",
                "description": "A plugin answers with the preferences it owns: {items: [{key, label, group, type, default, choices?, min?, max?}]}",
                "input": {"type":"object"}}}},
            "provides": [{"extension_point": "prefs.item"}],
            "data": {"collections": [PREFS], "version": 1},
            "events": {"prefs.changed": {}},
            "operations": {
                "prefs.schema": {"kind": "query", "description": "Every preference the enabled plugins declare, to build a settings window",
                    "output": {"type":"object","required":["items"]}},
                "prefs.get": {"kind": "query", "description": "Your preferences: every declared key with your value or its default", "output": {"type":"object","required":["theme","language"]}},
                "prefs.set": {"kind": "command", "description": "Change some of your preferences; each key must be declared and its value valid",
                    "input": {"type":"object","maxProperties":40},
                    "output": {"type":"object","required":["theme","language"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("prefs.item", |_tx, _i| {
            Ok(pref_answer(vec![
                json!({"key": "theme", "group": "appearance", "type": "string", "default": "phantom-onyx", "label": lbl("Theme", "السمة")}),
                json!({"key": "scheme", "group": "appearance", "type": "choice", "default": "auto", "label": lbl("Mode", "الوضع"), "choices": choices(&[("auto", "Follow the device", "حسب الجهاز"), ("light", "Light", "فاتح"), ("dark", "Dark", "داكن")])}),
                json!({"key": "language", "group": "appearance", "type": "choice", "default": "en", "label": lbl("Language", "اللغة"), "choices": choices(&[("en", "English", "English"), ("ar", "Arabic", "العربية")])}),
                json!({"key": "density", "group": "appearance", "type": "choice", "default": "comfortable", "label": lbl("Density", "الكثافة"), "choices": choices(&[("comfortable", "Comfortable", "مريح"), ("compact", "Compact", "مضغوط")])}),
                json!({"key": "calendar", "group": "appearance", "type": "choice", "default": "gregorian", "label": lbl("Calendar", "التقويم"), "choices": choices(&[("gregorian", "Gregorian", "ميلادي"), ("hijri", "Hijri", "هجري"), ("both", "Both", "كلاهما")])}),
                json!({"key": "avatar_color", "group": "account", "type": "color", "default": "", "label": lbl("Avatar colour", "لون الصورة الرمزية")}),
                json!({"key": "confirm_before_delete", "group": "behaviour", "type": "boolean", "default": true, "label": lbl("Confirm before deleting", "تأكيد قبل الحذف")}),
            ]))
        });
        /// All declared items, flattened; a provider that failed is skipped.
        fn declared(tx: &mut Tx) -> Result<Vec<Value>> {
            let answers = tx.extension_call("prefs.item", json!({}))?;
            let mut items = vec![];
            for a in answers.as_array().cloned().unwrap_or_default() {
                if a["ok"] == true {
                    items.extend(a["output"]["items"].as_array().cloned().unwrap_or_default());
                }
            }
            Ok(items)
        }
        fn check(item: &Value, v: &Value) -> Result<()> {
            let key = item["key"].as_str().unwrap_or("");
            let bad = |why: &str| Err(Error::invalid(key, why));
            match item["type"].as_str().unwrap_or("string") {
                "boolean" if !v.is_boolean() => bad("must be true or false"),
                "integer" => match v.as_i64() {
                    Some(n) if n >= item["min"].as_i64().unwrap_or(i64::MIN) && n <= item["max"].as_i64().unwrap_or(i64::MAX) => Ok(()),
                    _ => bad("must be a whole number in range"),
                },
                "choice" if !item["choices"].as_array().is_some_and(|c| c.iter().any(|x| &x["value"] == v)) => bad("is not one of the choices"),
                "color" => match v.as_str() {
                    Some("") => Ok(()),
                    Some(s) if s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()) => Ok(()),
                    _ => bad("must be empty or a colour like #1a2b3c"),
                },
                "string" if v.as_str().map_or(true, |s| s.is_empty() || s.len() > 60) => bad("must be 1 to 60 characters"),
                _ => Ok(()),
            }
        }
        b.op("prefs.schema", |tx, _| Ok(json!({"items": declared(tx)?})));
        b.op("prefs.get", |tx, _| {
            let items = declared(tx)?;
            let mine = tx.get(PREFS, &tx.who().subject)?.map(|d| d.body).unwrap_or(json!({}));
            let mut out = serde_json::Map::new();
            for it in &items {
                let k = it["key"].as_str().unwrap_or("");
                // a stored value that no longer passes (its plugin changed) falls back to the default
                let v = mine.get(k).filter(|v| check(it, v).is_ok()).unwrap_or(&it["default"]);
                out.insert(k.to_string(), v.clone());
            }
            Ok(Value::Object(out))
        });
        b.op("prefs.set", |tx, i| {
            let items = declared(tx)?;
            let me = tx.who().subject.clone();
            let cur = tx.get(PREFS, &me)?;
            let mut body = cur.as_ref().map(|d| d.body.clone()).unwrap_or(json!({}));
            for (k, v) in i.as_object().cloned().unwrap_or_default() {
                let Some(it) = items.iter().find(|x| x["key"] == k.as_str()) else { return Err(Error::invalid(&k, "is not a preference")) };
                check(it, &v)?;
                body[&k] = v;
            }
            tx.put(PREFS, &me, body, cur.map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent))?;
            let mut out = serde_json::Map::new();
            let mine = tx.get(PREFS, &me)?.map(|d| d.body).unwrap_or(json!({}));
            for it in &items {
                let k = it["key"].as_str().unwrap_or("");
                out.insert(k.to_string(), mine.get(k).cloned().unwrap_or_else(|| it["default"].clone()));
            }
            let out = Value::Object(out);
            tx.emit("prefs.changed", Audience::subject(&me), out.clone())?;
            Ok(out)
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
            "slots": [{"slot": "project.actions", "id": "export.project", "order": 10,
                "label": {"en": "Export", "ar": "تصدير"},
                "operation": "export.project", "args": {"project": "$project.id"},
                "result": "download", "file": "$project.name.json"}],
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

/// A theme preset: a data plugin holding a full token set (`theme/1`, see `appearance.rs` and `presets.json`).
pub struct Theme(pub String, pub String, pub String, pub Value);
impl Plugin for Theme {
    fn manifest(&self) -> Manifest {
        manifest(json!({"id": &self.0, "version": "0.3.0", "name": &self.1, "runtime": "data", "theme": &self.3, "description": &self.2}))
    }
}

/// The presets that ship with Madar. The first is the default.
pub fn themes() -> Vec<Theme> {
    let all: Vec<Value> = serde_json::from_str(include_str!("presets.json")).expect("presets.json is valid");
    all.into_iter()
        .map(|p| Theme(format!("theme-{}", p["id"].as_str().unwrap_or("")), p["name"].as_str().unwrap_or("").to_string(), p["tagline"].as_str().unwrap_or("").to_string(), p["theme"].clone()))
        .collect()
}

/// Plugin ids of the presets, for profiles.
pub fn theme_ids() -> Vec<String> {
    themes().into_iter().map(|t| t.0).collect()
}
