//! `tasks`: the board. Tasks, subtasks, labels, order, and the Today view.
//! Design: https://docs.addaui.com/nuah/specs/madar-v2/

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Value};

pub const TASKS: &str = "tasks.tasks";
pub const LABELS: &str = "tasks.labels";
const GAP: f64 = 1024.0;

pub fn view(d: &Doc) -> Value {
    let b = &d.body;
    json!({
        "id": d.id, "rev": d.rev, "project": b["project"], "title": b["title"], "notes": b["notes"],
        "status": b["status"], "priority": b["priority"], "band": band(b["priority"].as_i64().unwrap_or(0)),
        "due": b["due"], "assignee": b["assignee"], "labels": b["labels"], "parent": b["parent"],
        "position": b["position"], "archived": b["archived"], "created_by": b["created_by"],
        "created_at": b["created_at"], "completed_at": b["completed_at"],
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

fn column(tx: &Tx, project: &str, status: &str, except: Option<&str>) -> Result<Vec<Doc>> {
    let page = tx.query(TASKS, &Query::new().eq("project", project).eq("status", status).eq("archived", false).eq("parent", Value::Null).asc("position").limit(5000))?;
    Ok(page.items.into_iter().filter(|d| Some(d.id.as_str()) != except).collect())
}

fn end_of(tx: &Tx, project: &str, status: &str) -> Result<f64> {
    Ok(column(tx, project, status, None)?.last().and_then(|d| d.body["position"].as_f64()).map(|p| p + GAP).unwrap_or(GAP))
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
            "provides": [{"extension_point": "prefs.item", "optional": true}],
            "description": "Tasks on a board: columns, order, subtasks, labels, and a Today view",
            "requires": {"plugins": ["projects"], "capabilities": ["emit", "call"]},
            "data": {"collections": [TASKS, LABELS], "version": 1,
                     "indexes": [{"collection": TASKS, "field": "project"}, {"collection": TASKS, "field": "assignee"}, {"collection": TASKS, "field": "parent"}]},
            "events": {
                "tasks.created": {}, "tasks.updated": {}, "tasks.moved": {}, "tasks.removed": {},
                "tasks.assigned": {}, "tasks.completed": {}, "tasks.label_created": {}, "tasks.label_removed": {}
            },
            "operations": {
                "tasks.create": {"kind": "command", "description": "Add a task to a project, optionally as a subtask", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"tasks.assignee_not_member": "Only members can be assigned", "tasks.unknown_label": "That label is not in this project",
                                "tasks.bad_status": "That column does not exist", "tasks.bad_parent": "A subtask needs a top-level task of the same project as its parent"},
                    "input": {"type":"object","required":["project","title"],"properties":{
                        "project":proj,"title":{"type":"string","minLength":1,"maxLength":200},"notes":{"type":"string","maxLength":10000},
                        "status":{"type":"string"},"priority":{"type":"integer","minimum":0,"maximum":10},"due":date,
                        "assignee":{"type":["string","null"]},"labels":{"type":"array","maxItems":20,"items":{"type":"string"}},"parent":{"type":["string","null"]}},"additionalProperties":false},
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
                        "assignee":{"type":["string","null"]},"labels":{"type":"array","maxItems":20,"items":{"type":"string"}},"archived":{"type":"boolean"}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.move": {"kind": "command", "description": "Move a task to a column and a place in it", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "reasons": {"tasks.bad_status": "That column does not exist", "tasks.archived": "An archived task can only be restored"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"},"status":{"type":"string"},"after":{"type":["string","null"]}},"additionalProperties":false},
                    "output": task_out, "affordances": aff},
                "tasks.remove": {"kind": "command", "description": "Delete a task and its subtasks", "permission": "projects.write", "resource": {"type":"projects.project","id":"project"},
                    "input": {"type":"object","required":["project","id"],"properties":{"project":proj,"id":{"type":"string"}},"additionalProperties":false}},
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

    fn bind(&self, b: &mut Bindings) {
        b.provide("prefs.item", |_tx, _i| {
            Ok(crate::small::pref_answer(vec![
                json!({"key": "tasks.default_priority", "group": "behaviour", "type": "integer", "default": 0, "min": 0, "max": 10, "label": {"en": "Default task priority", "ar": "أولوية المهمة الافتراضية"}}),
                json!({"key": "tasks.due_soon_days", "group": "behaviour", "type": "integer", "default": 3, "min": 0, "max": 30, "label": {"en": "Due soon window (days)", "ar": "نافذة الاستحقاق القريب (أيام)"}}),
            ]))
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
            let me = tx.who().subject.clone();
            let now = tx.now();
            let done = status == last_status(&p);
            let d = tx.create(TASKS, json!({
                "project": project, "title": i["title"], "notes": i.get("notes").cloned().unwrap_or(json!("")), "status": status,
                "priority": i.get("priority").cloned().unwrap_or(json!(0)), "due": i.get("due").cloned().unwrap_or(Value::Null),
                "assignee": assignee, "labels": labels, "parent": parent, "position": position, "archived": false,
                "created_by": me, "created_at": now, "completed_at": if done { json!(now) } else { Value::Null },
            }))?;
            let aud = Audience::scope("projects.members", &project);
            tx.emit("tasks.created", aud, json!({"project": project, "task": view(&d)}))?;
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
            tx.emit("tasks.updated", Audience::scope("projects.members", &project), json!({"project": project, "task": view(&d), "changes": changes}))?;
            if changes.contains_key("assignee") {
                notify_assigned(tx, &d)?;
            }
            if is_done && !was_done {
                let by = tx.who().subject.clone();
                tx.emit("tasks.completed", Audience::scope("projects.members", &project), json!({"project": project, "task": d.id, "title": d.body["title"], "created_by": d.body["created_by"], "assignee": d.body["assignee"], "by": by}))?;
            }
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
            let moved = if crowded {
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
