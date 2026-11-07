//! `tasks`: the board. Tasks, subtasks, labels, order, and the Today view.
//! Design: https://docs.addaui.com/nuah/specs/madar-v2/

use crate::content::richtext;
use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const TASKS: &str = "tasks.tasks";
pub const COUNTERS: &str = "tasks.counters";
pub const LABELS: &str = "tasks.labels";
const GAP: f64 = 1024.0;

pub fn view(d: &Doc) -> Value {
    let b = &d.body;
    json!({
        "id": d.id, "rev": d.rev, "project": b["project"], "number": b.get("number").cloned().unwrap_or(Value::Null), "title": b["title"], "notes": b["notes"],
        "status": b["status"], "priority": b["priority"], "band": band(b["priority"].as_i64().unwrap_or(0)),
        "due": b["due"], "assignee": b["assignee"], "labels": b["labels"], "parent": b["parent"],
        "position": b["position"], "archived": b["archived"], "created_by": b["created_by"],
        "created_at": b["created_at"], "completed_at": b["completed_at"],
        "repeat": b.get("repeat").cloned().unwrap_or(Value::Null), "description": b.get("description").cloned().unwrap_or(Value::Null), "custom": b.get("custom").cloned().unwrap_or_else(|| json!({})),
    })
}

fn project_of(tx: &mut Tx, id: &str) -> Result<Value> {
    tx.call("projects.get", json!({"project": id}))
}

fn last_status(project: &Value) -> String {
    project["statuses"].as_array().and_then(|a| a.last()).map(|s| text(s, "id").to_string()).unwrap_or_default()
}

fn has_status(project: &Value, id: &str) -> bool {
    project["statuses"].as_array().is_some_and(|a| a.iter().any(|s| text(s, "id") == id))
}

fn must_get(tx: &Tx, project: &str, id: &str) -> Result<Doc> {
    let d = tx.get(TASKS, id)?.ok_or_else(|| Error::not_found("task"))?;
    if text(&d.body, "project") != project {
        return Err(Error::not_found("task"));
    }
    Ok(d)
}

fn check_assignee(tx: &mut Tx, project: &str, v: &Value) -> Result<()> {
    let Some(who) = v.as_str() else { return Ok(()) };
    let members = tx.call("projects.members", json!({"project": project}))?;
    if members["members"].as_array().is_some_and(|m| m.iter().any(|x| text(x, "subject") == who)) {
        Ok(())
    } else {
        Err(Error::reason(Category::Invalid, "tasks.assignee_not_member", "Only members of the project can be assigned").with_params(json!({"subject": who})))
    }
}

fn check_labels(tx: &Tx, project: &str, v: &Value) -> Result<()> {
    for id in ids_of(v) {
        let ok = tx.get(LABELS, &id)?.is_some_and(|l| text(&l.body, "project") == project);
        if !ok {
            return Err(Error::reason(Category::Invalid, "tasks.unknown_label", "That label is not in this project").with_params(json!({"label": id})));
        }
    }
    Ok(())
}

/// Values for a project's custom attributes (ADR 0024). `null` removes a value.
fn check_custom(project: &Value, custom: &Value) -> Result<()> {
    let schema = project["attributes"].as_array().cloned().unwrap_or_default();
    for (k, v) in custom.as_object().cloned().unwrap_or_default() {
        let field = format!("custom.{k}");
        let Some(a) = schema.iter().find(|a| text(a, "key") == k) else {
            return Err(Error::reason(Category::Invalid, "tasks.unknown_attribute", "That attribute is not defined in this project").with_params(json!({"key": k})));
        };
        if v.is_null() {
            continue;
        }
        let ok = match text(a, "type") {
            "text" => v.as_str().is_some_and(|s| s.len() <= 500),
            "number" => v.is_number(),
            "boolean" => v.is_boolean(),
            "date" => return check_date(&field, &v),
            "choice" => v.as_str().is_some_and(|s| a["choices"].as_array().is_some_and(|c| c.iter().any(|x| x == s))),
            _ => false,
        };
        if !ok {
            return Err(Error::invalid(&field, "does not fit the attribute's type"));
        }
    }
    Ok(())
}

fn merge_custom(old: &Value, change: &Value) -> Value {
    let mut out = old.as_object().cloned().unwrap_or_default();
    for (k, v) in change.as_object().cloned().unwrap_or_default() {
        if v.is_null() { out.remove(&k); } else { out.insert(k, v); }
    }
    Value::Object(out)
}

/// What the Face needs to order the day: higher is more urgent (ADR 0024).
fn urgency(priority: i64, due: Option<&str>, today: &str) -> f64 {
    let late = match (due.and_then(day_number), day_number(today)) {
        (Some(d), Some(t)) if d < t => (t - d) as f64,
        _ => 0.0,
    };
    let due_today = if due == Some(today) { 3.0 } else { 0.0 };
    priority as f64 * 1.5 + late * 2.0 + due_today
}

fn column(tx: &Tx, project: &str, status: &str, except: Option<&str>) -> Result<Vec<Doc>> {
    let page = tx.query(TASKS, &Query::new().eq("project", project).eq("status", status).eq("archived", false).eq("parent", Value::Null).asc("position").limit(5000))?;
    Ok(page.items.into_iter().filter(|d| Some(d.id.as_str()) != except).collect())
}

fn end_of(tx: &Tx, project: &str, status: &str) -> Result<f64> {
    Ok(column(tx, project, status, None)?.last().and_then(|d| d.body["position"].as_f64()).map(|p| p + GAP).unwrap_or(GAP))
}

/// A finished task that repeats leaves a fresh copy in the first column, due one interval later (ADR 0025).
/// The finished task remembers its successor so completing it twice never makes two.
fn spawn_next(tx: &mut Tx, p: &Value, done: Doc) -> Result<Doc> {
    let r = done.body.get("repeat").cloned().unwrap_or(Value::Null);
    let (Some(every), Some(unit)) = (r["every"].as_i64(), r["unit"].as_str()) else { return Ok(done) };
    if done.body["repeats_into"].is_string() || !done.body["parent"].is_null() {
        return Ok(done);
    }
    let today = date_of(tx.now());
    let base = done.body["due"].as_str().filter(|d| *d > today.as_str()).map(String::from).unwrap_or(today);
    let due = add_interval(&base, every, unit);
    let first = p["statuses"][0]["id"].as_str().unwrap_or("").to_string();
    let b = &done.body;
    let pos = end_of(tx, text(b, "project"), &first)?;
    let number = next_number(tx, COUNTERS, text(b, "project"))?;
    let next = tx.create(TASKS, json!({
        "project": b["project"], "title": b["title"], "notes": b["notes"], "status": first, "priority": b["priority"], "due": due,
        "assignee": b["assignee"], "labels": b["labels"], "parent": Value::Null, "position": pos, "archived": false,
        "created_by": b["created_by"], "created_at": tx.now(), "completed_at": Value::Null,
        "custom": b["custom"], "description": b.get("description").cloned().unwrap_or(Value::Null), "repeat": r, "repeat_of": done.id, "number": number,
    }))?;
    let mut body = done.body.clone();
    body["repeats_into"] = json!(next.id);
    let done = tx.put(TASKS, &done.id, body, Expect::Rev(done.rev))?;
    tx.emit("tasks.recurred", Audience::scope("projects.members", text(&done.body, "project")),
        json!({"project": done.body["project"], "from": done.id, "task": view(&next), "refs": richtext::refs_for("tasks.task", &next.id, text(&next.body, "title"), &next.body["description"])}))?;
    notify_assigned(tx, &next)?;
    Ok(done)
}

pub struct Tasks;

impl Plugin for Tasks {
    fn manifest(&self) -> Manifest {
        let task_out = json!({"type":"object","required":["id","rev","project","title","status"]});
        let aff = json!({"type":"projects.project","id":"project"});
        let date = json!({"type":["string","null"]});
        let proj = json!({"type":"string"});
        manifest(json!({
            "id": "tasks", "version": "0.3.0", "name": "Tasks", "namespaces": ["tasks"],
            "provides": [{"extension_point": "prefs.item", "optional": true}, {"extension_point": "search.source", "optional": true}],
            "description": "Tasks on a board: columns, order, subtasks, labels, and a Today view",
            "requires": {"plugins": ["projects"], "capabilities": ["emit", "call"]},
            "data": {"collections": [TASKS, LABELS, COUNTERS], "version": 2,
                     "indexes": [{"collection": TASKS, "field": "project"}, {"collection": TASKS, "field": "assignee"}, {"collection": TASKS, "field": "parent"}]},
            "events": {
                "tasks.created": {}, "tasks.recurred": {}, "tasks.updated": {}, "tasks.moved": {}, "tasks.removed": {},
                "tasks.assigned": {}, "tasks.completed": {}, "tasks.label_created": {}, "tasks.label_removed": {}
            },
            "operations": {
                "tasks.create": {"kind": "command", "description": "Add a task to a project, optionally as a subtask", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"tasks.assignee_not_member": "Only members can be assigned", "tasks.unknown_label": "That label is not in this project",
                                "tasks.bad_status": "That column does not exist", "tasks.bad_parent": "A subtask needs a top-level task of the same project as its parent"},
                    "input": {"type":"object","required":["project","title"],"properties":{
                        "project":proj,"title":{"type":"string","minLength":1,"maxLength":200},"notes":{"type":"string","maxLength":10000},
                        "status":{"type":"string"},"priority":{"type":"integer","minimum":0,"maximum":10},"due":date,
                        "assignee":{"type":["string","null"]},"labels":{"type":"array","maxItems":20,"items":{"type":"string"}},"parent":{"type":["string","null"]},"custom":{"type":"object"},"description":{"type":["object","null"]},"repeat":{"type":["object","null"],"additionalProperties":false,"required":["every","unit"],"properties":{"every":{"type":"integer","minimum":1,"maximum":365},"unit":{"enum":["day","week","month"]}}}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.get": {"kind": "query", "description": "One task", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.list": {"kind": "query", "description": "Tasks of a project, filtered and paged", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{
                        "project":proj,"status":{"type":"string"},"assignee":{"type":"string"},"label":{"type":"string"},"parent":{"type":["string","null"]},
                        "archived":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":500},"after":{"type":"integer","minimum":0}},"additionalProperties":false},
                    "output": {"type":"object","required":["tasks"]}, "affordances": {"type":"projects.project","id":"project","at":"tasks"}},
                "tasks.update": {"kind": "command", "description": "Change a task's fields; pass expected_rev to refuse overwriting someone else's edit", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"tasks.stale_revision": "The task changed since you read it", "tasks.archived": "An archived task can only be restored",
                                "tasks.assignee_not_member": "Only members can be assigned", "tasks.unknown_label": "That label is not in this project", "tasks.bad_status": "That column does not exist"},
                    "input": {"type":"object","required":["project","id"],"properties":{
                        "project":proj,"id":{"type":"string"},"expected_rev":{"type":"integer","minimum":1},"title":{"type":"string","minLength":1,"maxLength":200},
                        "notes":{"type":"string","maxLength":10000},"status":{"type":"string"},"priority":{"type":"integer","minimum":0,"maximum":10},"due":date,
                        "assignee":{"type":["string","null"]},"labels":{"type":"array","maxItems":20,"items":{"type":"string"}},"archived":{"type":"boolean"},"custom":{"type":"object"},"description":{"type":["object","null"]},"repeat":{"type":["object","null"],"additionalProperties":false,"required":["every","unit"],"properties":{"every":{"type":"integer","minimum":1,"maximum":365},"unit":{"enum":["day","week","month"]}}}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.move": {"kind": "command", "description": "Move a task to a column and a place in it", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"tasks.bad_status": "That column does not exist", "tasks.unknown_attribute": "That attribute is not defined in this project", "tasks.archived": "An archived task can only be restored"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"},"status":{"type":"string"},"after":{"type":["string","null"]}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.remove": {"kind": "command", "description": "Delete a task and its subtasks", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"}},"additionalProperties":false}},
                "tasks.query": {"kind": "query", "description": "Find tasks in a project: filter, sort (also by custom attributes), page", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":proj,"status":{"type":"string"},"assignee":{"type":["string","null"]},"label":{"type":"string"},
                        "priority_min":{"type":"integer","minimum":0,"maximum":10},"due_before":date,"due_after":date,"done":{"type":"boolean"},"archived":{"type":"boolean"},
                        "q":{"type":"string","maxLength":100},"custom":{"type":"object"},"sort":{"type":"string","maxLength":40},"desc":{"type":"boolean"},
                        "limit":{"type":"integer","minimum":1,"maximum":500},"after":{"type":"integer","minimum":0}},"additionalProperties":false},
                    "output": {"type":"object","required":["tasks"]}},
                "tasks.stats": {"kind": "query", "description": "Numbers for a project's overview: per column, per priority band, overdue, and completions per day", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":proj,"days":{"type":"integer","minimum":1,"maximum":120}},"additionalProperties":false},
                    "output": {"type":"object","required":["total","open","done","overdue","by_status","by_band","completed_per_day"]}},
                "tasks.focus": {"kind": "query", "description": "Where to start the day: your open tasks ranked by urgency, the top few and then some more",
                    "input": {"type":"object","properties":{"today":{"type":"string"}},"additionalProperties":false},
                    "output": {"type":"object","required":["start","also","today"]}},
                "tasks.my": {"kind": "query", "description": "Today: what is assigned to you, across projects",
                    "input": {"type":"object","properties":{"today":{"type":"string"}},"additionalProperties":false},
                    "output": {"type":"object","required":["tasks","today"]}, "affordances": {"type":"projects.project","id":"project","at":"tasks"}},
                "tasks.labels.create": {"kind": "command", "description": "Add a label to a project", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","name"],"properties":{"project":proj,"name":{"type":"string","minLength":1,"maxLength":40},"color":{"type":"string","maxLength":20}},"additionalProperties":false},
                    "output": {"type":"object","required":["id","name"]}},
                "tasks.labels.list": {"kind": "query", "description": "The labels of a project", "permission": "projects.read", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project"],"properties":{"project":proj},"additionalProperties":false},
                    "output": {"type":"object","required":["labels"]}},
                "tasks.labels.remove": {"kind": "command", "description": "Remove a label from a project and from its tasks", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"}},"additionalProperties":false}}
            },
            "hooks": [{"stage": "before", "on": "projects.update", "order": 0, "handler": "tasks.guard_columns",
                       "reasons": {"tasks.status_in_use": "A column that still holds tasks cannot be removed"}}],
            "listeners": [{"id": "tasks.on_project_event", "on": ["projects.deleted", "projects.unshared"], "handler": "tasks.on_project_event"}]
        }))
    }

    fn migrate(&self, from: u32, tx: &mut Tx) -> Result<()> {
        if from != 1 {
            return Ok(());
        }
        // version 2: number the tasks of each project in the order they were made
        let all = tx.query(TASKS, &Query::new().asc("created_at").limit(20000))?.items;
        let mut last: std::collections::BTreeMap<String, i64> = Default::default();
        for d in &all {
            if let Some(n) = d.body["number"].as_i64() {
                let e = last.entry(text(&d.body, "project").to_string()).or_insert(0);
                *e = (*e).max(n);
            }
        }
        for d in all.into_iter().filter(|d| d.body["number"].is_null()) {
            let e = last.entry(text(&d.body, "project").to_string()).or_insert(0);
            *e += 1;
            let mut body = d.body.clone();
            body["number"] = json!(*e);
            tx.put(TASKS, &d.id, body, Expect::Rev(d.rev))?;
        }
        for (project, n) in last {
            tx.put(COUNTERS, &project, json!({"next": n + 1}), Expect::Any)?;
        }
        Ok(())
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("prefs.item", |_tx, _i| {
            Ok(crate::small::pref_answer(vec![
                json!({"key": "tasks.default_priority", "group": "behaviour", "type": "integer", "default": 0, "min": 0, "max": 10, "label": {"en": "Default task priority", "ar": "أولوية المهمة الافتراضية"}}),
                json!({"key": "tasks.due_soon_days", "group": "behaviour", "type": "integer", "default": 3, "min": 0, "max": 30, "label": {"en": "Due soon window (days)", "ar": "نافذة الاستحقاق القريب (أيام)"}}),
            ]))
        });
        b.provide("search.source", |tx, i| {
            let q = text(&i, "q").to_string();
            let projects = tx.call("projects.list", json!({}))?;
            let mut items = vec![];
            for p in projects["projects"].as_array().cloned().unwrap_or_default() {
                let pid = text(&p, "id").to_string();
                for d in tx.query(TASKS, &Query::new().eq("project", pid.as_str()).eq("archived", false).limit(5000))?.items {
                    let body = format!("{}\n{}", text(&d.body, "notes"), richtext::text_of(d.body.get("description").unwrap_or(&Value::Null)));
                    if let Some((score, snippet)) = crate::search::score(&q, text(&d.body, "title"), &body) {
                        items.push(json!({"kind": "task", "id": d.id, "title": d.body["title"], "snippet": snippet, "score": score,
                            "project": pid, "project_name": p["name"], "done": !d.body["completed_at"].is_null()}));
                    }
                }
            }
            items.sort_by(|a, b| b["score"].as_f64().partial_cmp(&a["score"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
            items.truncate(50);
            Ok(json!({"items": items}))
        });

        b.op("tasks.create", |tx, i| {
            let project = text(&i, "project").to_string();
            let p = project_of(tx, &project)?;
            let status = i.get("status").and_then(|s| s.as_str()).map(String::from).unwrap_or_else(|| p["statuses"][0]["id"].as_str().unwrap_or("").to_string());
            if !has_status(&p, &status) {
                return Err(Error::reason(Category::Invalid, "tasks.bad_status", "That column does not exist"));
            }
            let assignee = i.get("assignee").cloned().unwrap_or(Value::Null);
            check_assignee(tx, &project, &assignee)?;
            let labels = i.get("labels").cloned().unwrap_or_else(|| json!([]));
            check_labels(tx, &project, &labels)?;
            if let Some(due) = i.get("due") {
                check_date("due", due)?;
            }
            let parent = i.get("parent").cloned().unwrap_or(Value::Null);
            if let Some(pid) = parent.as_str() {
                let ok = tx.get(TASKS, pid)?.is_some_and(|t| text(&t.body, "project") == project && t.body["parent"].is_null() && t.body["archived"] == false);
                if !ok {
                    return Err(Error::reason(Category::Invalid, "tasks.bad_parent", "A subtask needs a top-level task of the same project as its parent"));
                }
            }
            let position = if parent.is_null() { end_of(tx, &project, &status)? } else { GAP };
            let custom = i.get("custom").cloned().unwrap_or_else(|| json!({}));
            check_custom(&p, &custom)?;
            let description = i.get("description").cloned().unwrap_or(Value::Null);
            if !description.is_null() {
                richtext::check("description", &description)?;
            }
            let me = tx.who().subject.clone();
            let now = tx.now();
            let done = status == last_status(&p);
            let number = next_number(tx, COUNTERS, &project)?;
            let d = tx.create(TASKS, json!({
                "project": project, "title": i["title"], "notes": i.get("notes").cloned().unwrap_or(json!("")), "status": status,
                "priority": i.get("priority").cloned().unwrap_or(json!(0)), "due": i.get("due").cloned().unwrap_or(Value::Null),
                "assignee": assignee, "labels": labels, "parent": parent, "position": position, "archived": false,
                "created_by": me, "created_at": now, "completed_at": if done { json!(now) } else { Value::Null }, "number": number,
                "custom": custom, "description": description, "repeat": i.get("repeat").cloned().unwrap_or(Value::Null),
            }))?;
            let aud = Audience::scope("projects.members", &project);
            tx.emit("tasks.created", aud, json!({"project": project, "task": view(&d), "refs": richtext::refs_for("tasks.task", &d.id, text(&d.body, "title"), &d.body["description"])}))?;
            notify_assigned(tx, &d)?;
            Ok(view(&d))
        });

        b.op("tasks.get", |tx, i| Ok(view(&must_get(tx, text(&i, "project"), text(&i, "id"))?)));

        b.op("tasks.list", |tx, i| {
            let project = text(&i, "project");
            let mut q = Query::new().eq("project", project).eq("archived", i.get("archived").and_then(|a| a.as_bool()).unwrap_or(false));
            if let Some(s) = i.get("status") {
                q = q.eq("status", s.clone());
            }
            if let Some(a) = i.get("assignee") {
                q = q.eq("assignee", a.clone());
            }
            if let Some(l) = i.get("label") {
                q = q.has("labels", l.clone());
            }
            if let Some(p) = i.get("parent") {
                q = q.eq("parent", p.clone());
            }
            let q = q.asc("position").limit(i.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize).offset(i.get("after").and_then(|l| l.as_u64()).unwrap_or(0) as usize);
            let page = tx.query(TASKS, &q)?;
            Ok(json!({"tasks": page.items.iter().map(view).collect::<Vec<_>>(), "next": page.next}))
        });

        b.op("tasks.update", |tx, i| {
            let project = text(&i, "project").to_string();
            let old = must_get(tx, &project, text(&i, "id"))?;
            if let Some(n) = i["expected_rev"].as_u64() {
                if n != old.rev {
                    return Err(Error::reason(Category::Conflict, "tasks.stale_revision", "The task changed since you read it"));
                }
            }
            let only_restore = i.as_object().is_some_and(|o| o.keys().all(|k| ["project", "id", "expected_rev", "archived"].contains(&k.as_str())));
            if old.body["archived"] == true && !(only_restore && i["archived"] == false) {
                return Err(Error::reason(Category::Conflict, "tasks.archived", "An archived task can only be restored"));
            }
            let mut body = old.body.clone();
            let mut changes = serde_json::Map::new();
            let p = project_of(tx, &project)?;
            for field in ["title", "notes", "priority", "due", "assignee", "labels", "archived", "status"] {
                let Some(new) = i.get(field) else { continue };
                if &body[field] == new {
                    continue;
                }
                match field {
                    "status" if !has_status(&p, new.as_str().unwrap_or("")) => return Err(Error::reason(Category::Invalid, "tasks.bad_status", "That column does not exist")),
                    "due" => check_date("due", new)?,
                    "assignee" => check_assignee(tx, &project, new)?,
                    "labels" => check_labels(tx, &project, new)?,
                    _ => {}
                }
                changes.insert(field.into(), json!([body[field], new]));
                body[field] = new.clone();
            }
            if let Some(c) = i.get("custom") {
                check_custom(&p, c)?;
                let merged = merge_custom(&body["custom"], c);
                if merged != body["custom"] {
                    changes.insert("custom".into(), json!([body["custom"], merged]));
                    body["custom"] = merged;
                }
            }
            if let Some(r) = i.get("repeat") {
                if r != &body["repeat"] && !(r.is_null() && body.get("repeat").is_none()) {
                    changes.insert("repeat".into(), json!([body.get("repeat").cloned().unwrap_or(Value::Null), r]));
                    body["repeat"] = r.clone();
                }
            }
            if let Some(dsc) = i.get("description") {
                if !dsc.is_null() {
                    richtext::check("description", dsc)?;
                }
                if dsc != &body["description"] {
                    changes.insert("description".into(), json!(true));
                    body["description"] = dsc.clone();
                }
            }
            if changes.is_empty() {
                return Ok(view(&old));
            }
            let last = last_status(&p);
            let was_done = text(&old.body, "status") == last;
            let is_done = text(&body, "status") == last;
            if is_done && !was_done {
                body["completed_at"] = json!(tx.now());
            } else if !is_done && was_done {
                body["completed_at"] = Value::Null;
            }
            if changes.contains_key("status") && body["parent"].is_null() {
                body["position"] = json!(end_of(tx, &project, text(&body, "status"))?);
            }
            let d = tx.put(TASKS, &old.id, body, Expect::Rev(old.rev)).map_err(|e| stale(e, "tasks.stale_revision", "The task"))?;
            tx.emit("tasks.updated", Audience::scope("projects.members", &project), json!({"project": project, "task": view(&d), "changes": changes,
                "refs": richtext::refs_for("tasks.task", &d.id, text(&d.body, "title"), &d.body["description"])}))?;
            if changes.contains_key("assignee") {
                notify_assigned(tx, &d)?;
            }
            let d = if is_done && !was_done {
                let by = tx.who().subject.clone();
                tx.emit("tasks.completed", Audience::scope("projects.members", &project), json!({"project": project, "task": d.id, "title": d.body["title"], "created_by": d.body["created_by"], "assignee": d.body["assignee"], "by": by}))?;
                spawn_next(tx, &p, d)?
            } else { d };
            Ok(view(&d))
        });

        b.op("tasks.move", |tx, i| {
            let project = text(&i, "project").to_string();
            let t = must_get(tx, &project, text(&i, "id"))?;
            if t.body["archived"] == true {
                return Err(Error::reason(Category::Conflict, "tasks.archived", "An archived task can only be restored"));
            }
            let p = project_of(tx, &project)?;
            let status = i.get("status").and_then(|s| s.as_str()).unwrap_or(text(&t.body, "status")).to_string();
            if !has_status(&p, &status) {
                return Err(Error::reason(Category::Invalid, "tasks.bad_status", "That column does not exist"));
            }
            let mut col = column(tx, &project, &status, Some(&t.id))?;
            let at = match i.get("after").and_then(|a| a.as_str()) {
                None => 0,
                Some(a) => col.iter().position(|d| d.id == a).map(|n| n + 1).ok_or_else(|| Error::not_found("task to place after"))?,
            };
            let before = if at == 0 { None } else { col[at - 1].body["position"].as_f64() };
            let next = col.get(at).and_then(|d| d.body["position"].as_f64());
            let pos = match (before, next) {
                (None, None) => GAP,
                (None, Some(n)) => n - GAP,
                (Some(b), None) => b + GAP,
                (Some(b), Some(n)) => (b + n) / 2.0,
            };
            let crowded = matches!((before, next), (Some(b), Some(n)) if (n - b).abs() < 1e-6);
            let was_done = text(&t.body, "status") == last_status(&p);
            let is_done = status == last_status(&p);
            let mut body = t.body.clone();
            body["status"] = json!(status);
            body["position"] = json!(pos);
            if is_done && !was_done {
                body["completed_at"] = json!(tx.now());
            } else if !is_done && was_done {
                body["completed_at"] = Value::Null;
            }
            let mut positions = serde_json::Map::new();
            let mut moved = if crowded {
                // renumber the whole column, with the moved task in its place
                let mut order: Vec<String> = col.drain(..).map(|d| d.id).collect();
                order.insert(at, t.id.clone());
                let mut moved = None;
                for (n, id) in order.iter().enumerate() {
                    let p = GAP * (n as f64 + 1.0);
                    positions.insert(id.clone(), json!(p));
                    if *id == t.id {
                        body["position"] = json!(p);
                        moved = Some(tx.put(TASKS, id, body.clone(), Expect::Rev(t.rev))?);
                    } else {
                        let d = tx.get(TASKS, id)?.ok_or_else(|| Error::internal("column changed"))?;
                        let mut b2 = d.body.clone();
                        b2["position"] = json!(p);
                        tx.put(TASKS, id, b2, Expect::Rev(d.rev))?;
                    }
                }
                moved.ok_or_else(|| Error::internal("moved task vanished"))?
            } else {
                positions.insert(t.id.clone(), json!(pos));
                tx.put(TASKS, &t.id, body, Expect::Rev(t.rev)).map_err(|e| stale(e, "tasks.stale_revision", "The task"))?
            };
            tx.emit("tasks.moved", Audience::scope("projects.members", &project), json!({"project": project, "task": t.id, "status": status, "positions": positions}))?;
            if is_done && !was_done {
                let by = tx.who().subject.clone();
                tx.emit("tasks.completed", Audience::scope("projects.members", &project), json!({"project": project, "task": t.id, "title": t.body["title"], "created_by": t.body["created_by"], "assignee": t.body["assignee"], "by": by}))?;
                moved = spawn_next(tx, &p, moved)?;
            }
            Ok(view(&moved))
        });

        b.op("tasks.remove", |tx, i| {
            let project = text(&i, "project").to_string();
            let t = must_get(tx, &project, text(&i, "id"))?;
            let subs = tx.query(TASKS, &Query::new().eq("parent", t.id.as_str()).limit(1000))?;
            let sub_ids: Vec<String> = subs.items.iter().map(|d| d.id.clone()).collect();
            for s in &sub_ids {
                tx.delete(TASKS, s)?;
            }
            tx.delete(TASKS, &t.id)?;
            tx.emit("tasks.removed", Audience::scope("projects.members", &project), json!({"project": project, "task": t.id, "subtasks": sub_ids, "title": t.body["title"]}))?;
            Ok(json!({}))
        });


        b.op("tasks.query", |tx, i| {
            let project = text(&i, "project").to_string();
            let mut q = Query::new().eq("project", project.as_str()).eq("archived", i["archived"] == true);
            if let Some(s) = i.get("status") { q = q.eq("status", s.clone()); }
            if let Some(a) = i.get("assignee") { q = q.eq("assignee", a.clone()); }
            if let Some(l) = i.get("label") { q = q.has("labels", l.clone()); }
            if let Some(p) = i.get("priority_min") { q = q.gte("priority", p.clone()); }
            if let Some(d) = i.get("due_before") { check_date("due_before", d)?; q = q.lte("due", d.clone()); }
            if let Some(d) = i.get("due_after") { check_date("due_after", d)?; q = q.gte("due", d.clone()); }
            match i.get("done").and_then(|d| d.as_bool()) {
                Some(true) => q = q.ne("completed_at", Value::Null),
                Some(false) => q = q.eq("completed_at", Value::Null),
                None => {}
            }
            let p = project_of(tx, &project)?;
            for (k, v) in i.get("custom").and_then(|c| c.as_object()).cloned().unwrap_or_default() {
                check_custom(&p, &json!({ k.clone(): v.clone() }))?;
                q = q.eq(&format!("custom.{k}"), v);
            }
            let sort = i.get("sort").and_then(|s| s.as_str()).unwrap_or("position");
            let sortable = ["position", "title", "priority", "due", "created_at", "completed_at", "status"];
            let field = if let Some(k) = sort.strip_prefix("custom.") {
                if !p["attributes"].as_array().is_some_and(|a| a.iter().any(|x| text(x, "key") == k)) {
                    return Err(Error::invalid("sort", "is not an attribute of this project"));
                }
                sort.to_string()
            } else if sortable.contains(&sort) {
                sort.to_string()
            } else {
                return Err(Error::invalid("sort", "cannot sort by that"));
            };
            q = if i["desc"] == true { q.desc(&field) } else { q.asc(&field) };
            let q = q.limit(5000);
            let needle = text(&i, "q").to_lowercase();
            let mut rows: Vec<Doc> = tx.query(TASKS, &q)?.items;
            if !needle.is_empty() {
                rows.retain(|d| text(&d.body, "title").to_lowercase().contains(&needle) || text(&d.body, "notes").to_lowercase().contains(&needle));
            }
            let (limit, after) = (i.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize, i.get("after").and_then(|l| l.as_u64()).unwrap_or(0) as usize);
            let total = rows.len();
            let page: Vec<Value> = rows.iter().skip(after).take(limit).map(view).collect();
            Ok(json!({"tasks": page, "total": total, "next": if after + limit < total { json!(after + limit) } else { Value::Null }}))
        });

        b.op("tasks.stats", |tx, i| {
            let project = text(&i, "project").to_string();
            let days = i.get("days").and_then(|d| d.as_i64()).unwrap_or(30);
            let p = project_of(tx, &project)?;
            let today = date_of(tx.now());
            let last = last_status(&p);
            let rows = tx.query(TASKS, &Query::new().eq("project", project.as_str()).eq("archived", false).limit(5000))?.items;
            let mut by_status = serde_json::Map::new();
            for s in p["statuses"].as_array().cloned().unwrap_or_default() {
                by_status.insert(text(&s, "id").to_string(), json!(0));
            }
            let mut by_band = serde_json::Map::new();
            for b_ in ["low", "medium", "high", "urgent"] {
                by_band.insert(b_.into(), json!(0));
            }
            let (mut open, mut done, mut overdue) = (0u64, 0u64, 0u64);
            let mut per_day: std::collections::BTreeMap<String, u64> = (0..days).map(|n| (days_before(&today, n), 0)).collect();
            for d in &rows {
                let st = text(&d.body, "status").to_string();
                if let Some(n) = by_status.get_mut(&st) { *n = json!(n.as_u64().unwrap_or(0) + 1); }
                if st == last {
                    done += 1;
                    if let Some(at) = d.body["completed_at"].as_i64() {
                        if let Some(n) = per_day.get_mut(&date_of(at)) { *n += 1; }
                    }
                } else {
                    open += 1;
                    let bd = band(d.body["priority"].as_i64().unwrap_or(0));
                    if let Some(n) = by_band.get_mut(bd) { *n = json!(n.as_u64().unwrap_or(0) + 1); }
                    if d.body["due"].as_str().is_some_and(|x| x < today.as_str()) { overdue += 1; }
                }
            }
            Ok(json!({"total": rows.len(), "open": open, "done": done, "overdue": overdue, "by_status": by_status, "by_band": by_band, "today": today,
                "completed_per_day": per_day.into_iter().map(|(date, n)| json!({"date": date, "n": n})).collect::<Vec<_>>()}))
        });

        b.op("tasks.focus", |tx, i| {
            let today = i.get("today").and_then(|t| t.as_str()).map(String::from).unwrap_or_else(|| date_of(tx.now()));
            let me = tx.who().subject.clone();
            let projects = tx.call("projects.list", json!({}))?;
            let mut scored: Vec<(f64, Value)> = vec![];
            for p in projects["projects"].as_array().cloned().unwrap_or_default() {
                let pid = text(&p, "id").to_string();
                let last = last_status(&p);
                let page = tx.query(TASKS, &Query::new().eq("project", pid.as_str()).eq("assignee", me.as_str()).eq("archived", false).limit(1000))?;
                for d in page.items.iter().filter(|d| text(&d.body, "status") != last) {
                    let score = urgency(d.body["priority"].as_i64().unwrap_or(0), d.body["due"].as_str(), &today);
                    let mut v = view(d);
                    v["project_name"] = p["name"].clone();
                    v["score"] = json!(score);
                    scored.push((score, v));
                }
            }
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| text(&a.1, "due").cmp(text(&b.1, "due"))).then_with(|| text(&a.1, "id").cmp(text(&b.1, "id"))));
            let rows: Vec<Value> = scored.into_iter().map(|(_, v)| v).collect();
            Ok(json!({"today": today, "start": rows.iter().take(5).cloned().collect::<Vec<_>>(), "also": rows.iter().skip(5).take(10).cloned().collect::<Vec<_>>(), "open": rows.len()}))
        });

        b.op("tasks.my", |tx, i| {
            let today = i.get("today").and_then(|t| t.as_str()).map(String::from).unwrap_or_else(|| date_of(tx.now()));
            let me = tx.who().subject.clone();
            let projects = tx.call("projects.list", json!({}))?;
            let mut out = vec![];
            for p in projects["projects"].as_array().cloned().unwrap_or_default() {
                let pid = text(&p, "id").to_string();
                let last = last_status(&p);
                let page = tx.query(TASKS, &Query::new().eq("project", pid.as_str()).eq("assignee", me.as_str()).eq("archived", false).limit(500))?;
                for d in page.items.iter().filter(|d| text(&d.body, "status") != last) {
                    let due = d.body["due"].as_str();
                    let bucket = match due {
                        None => "undated",
                        Some(x) if x < today.as_str() => "overdue",
                        Some(x) if x == today => "today",
                        _ => "upcoming",
                    };
                    let mut v = view(d);
                    v["bucket"] = json!(bucket);
                    v["project_name"] = p["name"].clone();
                    out.push(v);
                }
            }
            let rank = |b: &str| ["overdue", "today", "upcoming", "undated"].iter().position(|x| *x == b).unwrap_or(9);
            out.sort_by(|a, b| rank(text(a, "bucket")).cmp(&rank(text(b, "bucket"))).then_with(|| text(a, "due").cmp(text(b, "due"))).then_with(|| b["priority"].as_i64().cmp(&a["priority"].as_i64())));
            Ok(json!({"today": today, "tasks": out}))
        });

        b.op("tasks.labels.create", |tx, i| {
            let project = text(&i, "project").to_string();
            let name = text(&i, "name").trim().to_string();
            let dup = tx.count(LABELS, &[Cond { field: "project".into(), op: Cmp::Eq, value: json!(project) }, Cond { field: "name".into(), op: Cmp::Eq, value: json!(name) }])?;
            if dup > 0 {
                return Err(Error::reason(Category::Conflict, "tasks.label_exists", "A label with that name already exists"));
            }
            let d = tx.create(LABELS, json!({"project": project, "name": name, "color": i.get("color").cloned().unwrap_or(json!("gray"))}))?;
            tx.emit("tasks.label_created", Audience::scope("projects.members", &project), json!({"project": project, "label": d.id, "name": name}))?;
            Ok(json!({"id": d.id, "name": name, "color": d.body["color"]}))
        });
        b.op("tasks.labels.list", |tx, i| {
            let page = tx.query(LABELS, &Query::new().eq("project", text(&i, "project")).asc("name").limit(500))?;
            Ok(json!({"labels": page.items.iter().map(|d| json!({"id": d.id, "name": d.body["name"], "color": d.body["color"]})).collect::<Vec<_>>()}))
        });
        b.op("tasks.labels.remove", |tx, i| {
            let project = text(&i, "project").to_string();
            let id = text(&i, "id").to_string();
            let l = tx.get(LABELS, &id)?.filter(|l| text(&l.body, "project") == project).ok_or_else(|| Error::not_found("label"))?;
            let page = tx.query(TASKS, &Query::new().eq("project", project.as_str()).has("labels", id.as_str()).limit(2000))?;
            for t in page.items {
                let mut body = t.body.clone();
                body["labels"] = json!(ids_of(&t.body["labels"]).into_iter().filter(|x| *x != id).collect::<Vec<_>>());
                tx.put(TASKS, &t.id, body, Expect::Rev(t.rev))?;
            }
            tx.delete(LABELS, &l.id)?;
            tx.emit("tasks.label_removed", Audience::scope("projects.members", &project), json!({"project": project, "label": id}))?;
            Ok(json!({}))
        });

        // A column that still holds tasks cannot be removed from the project.
        b.before("tasks.guard_columns", |tx, _op, input| {
            let Some(new) = input.get("statuses").and_then(|s| s.as_array()) else { return Ok(()) };
            let project = text(input, "project").to_string();
            let current = tx.call("projects.get", json!({"project": project}))?;
            for s in current["statuses"].as_array().cloned().unwrap_or_default() {
                let id = text(&s, "id");
                if new.iter().any(|n| text(n, "id") == id) {
                    continue;
                }
                let n = tx.count(TASKS, &[Cond { field: "project".into(), op: Cmp::Eq, value: json!(project) }, Cond { field: "status".into(), op: Cmp::Eq, value: json!(id) }])?;
                if n > 0 {
                    return Err(Error::reason(Category::Conflict, "tasks.status_in_use", "A column that still holds tasks cannot be removed").with_params(json!({"status": id, "tasks": n})));
                }
            }
            Ok(())
        });

        b.listener("tasks.on_project_event", |tx, d| {
            let project = text(&d.event.data, "project").to_string();
            match d.event.kind.as_str() {
                "projects.deleted" => {
                    for coll in [TASKS, LABELS] {
                        loop {
                            let page = tx.query(coll, &Query::new().eq("project", project.as_str()).limit(200))?;
                            if page.items.is_empty() {
                                break;
                            }
                            for t in page.items {
                                tx.delete(coll, &t.id)?;
                            }
                        }
                    }
                }
                "projects.unshared" => {
                    let who = text(&d.event.data, "subject").to_string();
                    let page = tx.query(TASKS, &Query::new().eq("project", project.as_str()).eq("assignee", who.as_str()).limit(1000))?;
                    for t in page.items {
                        let mut body = t.body.clone();
                        body["assignee"] = Value::Null;
                        let nd = tx.put(TASKS, &t.id, body, Expect::Rev(t.rev))?;
                        tx.emit("tasks.updated", Audience::scope("projects.members", &project), json!({"project": project, "task": view(&nd), "changes": {"assignee": [who, null]}}))?;
                    }
                }
                _ => {}
            }
            Ok(())
        });
    }
}

fn notify_assigned(tx: &mut Tx, d: &Doc) -> Result<()> {
    let Some(to) = d.body["assignee"].as_str() else { return Ok(()) };
    let project = text(&d.body, "project").to_string();
    let by = tx.who().subject.clone();
    tx.emit("tasks.assigned", Audience::scope("projects.members", &project), json!({"project": project, "task": d.id, "title": d.body["title"], "assignee": to, "by": by}))
}
