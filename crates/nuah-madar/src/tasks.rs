//! The Madar task domain as one plugin: projects, tasks, comments (one level of replies),
//! follow-ups. It knows nothing about transports, auth, or which database it runs on.
//!
//! Vocabulary follows Madar's domain context: a Task has a Status drawn from its Project's list,
//! the last Status is the completion status, Priority is 0-10 with a derived band.

use nuah_kernel::*;
use serde_json::{json, Map, Value};

const OPS: [&str; 15] = [
    "projects.create", "projects.list", "projects.get", "projects.update", "projects.delete",
    "tasks.create", "tasks.get", "tasks.list", "tasks.update", "tasks.delete",
    "comments.add", "comments.list", "comments.delete",
    "followups.add", "followups.list",
];

pub const DEFAULT_STATUSES: [&str; 4] = ["Backlog", "Planning", "In Progress", "Done"];

pub struct TasksPlugin;

impl Plugin for TasksPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({
                "id": "tasks", "version": "0.1.0", "kind": "domain", "quality": "silver",
                "requires": {"ports": ["db", "ids"], "capabilities": ["events"]},
                "contributes": {"ops": OPS}
            })
            .to_string(),
        )
    }

    fn activate(&self, a: &mut Activation) -> Result<()> {
        let id = json!({"type":"object","required":["id"],"properties":{"id":{"type":"string","minLength":1}},"additionalProperties":false});
        let status_list = json!({"type":"array","minItems":1,"maxItems":12,"items":{"type":"string","minLength":1,"maxLength":40}});
        let attr_schema = json!({"type":"object"});

        a.op(OpSpec::command("projects.create", "tasks.write", "Create a project.",
            json!({"type":"object","required":["name"],"additionalProperties":false,"properties":{
                "name":{"type":"string","minLength":1,"maxLength":120},
                "statuses": status_list,
                "attributes": attr_schema}})).entity("projects"), projects_create);
        a.op(OpSpec::query("projects.list", "tasks.read", "List your projects with task counts.",
            json!({"type":"object","additionalProperties":false,"properties":{}})), projects_list);
        a.op(OpSpec::query("projects.get", "tasks.read", "Get one project.", id.clone()), projects_get);
        a.op(OpSpec::command("projects.update", "tasks.write", "Rename a project or change its statuses and attribute schema.",
            json!({"type":"object","required":["id"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},
                "name":{"type":"string","minLength":1,"maxLength":120},
                "statuses": status_list,
                "attributes": attr_schema}})).entity("projects"), projects_update);
        a.op(OpSpec::command("projects.delete", "tasks.write", "Delete an empty project.", id.clone()).entity("projects"), projects_delete);

        a.op(OpSpec::command("tasks.create", "tasks.write", "Create a task in a project.",
            json!({"type":"object","required":["project_id","title"],"additionalProperties":false,"properties":{
                "project_id":{"type":"string","minLength":1},
                "title":{"type":"string","minLength":1,"maxLength":200},
                "description":{"type":"string","maxLength":20000},
                "status":{"type":"string","minLength":1},
                "priority":{"type":"integer","minimum":0,"maximum":10},
                "due":{"type":["string","null"]},
                "attributes":{"type":"object"}}})).entity("tasks"), tasks_create);
        a.op(OpSpec::query("tasks.get", "tasks.read", "Get one task.", id.clone()), tasks_get);
        a.op(OpSpec::query("tasks.list", "tasks.read", "List tasks, optionally by project, status or title text.",
            json!({"type":"object","additionalProperties":false,"properties":{
                "project_id":{"type":"string"},"status":{"type":"string"},"q":{"type":"string","maxLength":200},
                "limit":{"type":"integer","minimum":1,"maximum":500}}})), tasks_list);
        a.op(OpSpec::command("tasks.update", "tasks.write", "Change fields of a task. Moving it to the last status completes it.",
            json!({"type":"object","required":["id"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},
                "title":{"type":"string","minLength":1,"maxLength":200},
                "description":{"type":"string","maxLength":20000},
                "status":{"type":"string","minLength":1},
                "priority":{"type":"integer","minimum":0,"maximum":10},
                "due":{"type":["string","null"]},
                "attributes":{"type":"object"}}})).entity("tasks"), tasks_update);
        a.op(OpSpec::command("tasks.delete", "tasks.write", "Delete a task with its comments and follow-ups.", id.clone()).entity("tasks"), tasks_delete);

        a.op(OpSpec::command("comments.add", "tasks.write", "Comment on a task, or reply to a comment (one level only).",
            json!({"type":"object","required":["task_id","text"],"additionalProperties":false,"properties":{
                "task_id":{"type":"string","minLength":1},"text":{"type":"string","minLength":1,"maxLength":10000},
                "parent_id":{"type":"string","minLength":1}}})).entity("comments"), comments_add);
        a.op(OpSpec::query("comments.list", "tasks.read", "Comments of a task, oldest first.",
            json!({"type":"object","required":["task_id"],"additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1}}})), comments_list);
        a.op(OpSpec::command("comments.delete", "tasks.write", "Delete a comment and its replies.", id.clone()).entity("comments"), comments_delete);

        a.op(OpSpec::command("followups.add", "tasks.write", "Record an update on a task without changing its description.",
            json!({"type":"object","required":["task_id","text"],"additionalProperties":false,"properties":{
                "task_id":{"type":"string","minLength":1},"text":{"type":"string","minLength":1,"maxLength":20000}}})).entity("followups"), followups_add);
        a.op(OpSpec::query("followups.list", "tasks.read", "Follow-ups of a task, oldest first.",
            json!({"type":"object","required":["task_id"],"additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1}}})), followups_list);
        Ok(())
    }
}

// ---------- helpers ----------

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

pub fn priority_band(p: i64) -> &'static str {
    match p {
        i64::MIN..=0 => "None",
        1..=3 => "Low",
        4..=6 => "Medium",
        7..=9 => "High",
        _ => "Urgent",
    }
}

fn present_task(mut t: Value) -> Value {
    let p = t["priority"].as_i64().unwrap_or(0);
    t["band"] = json!(priority_band(p));
    t
}

/// YYYY-MM-DD with a real calendar check.
pub fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (s[0..4].parse::<u32>(), s[5..7].parse::<u32>(), s[8..10].parse::<u32>()) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if leap { 29 } else { 28 },
        _ => return false,
    };
    d >= 1 && d <= days
}

fn check_due(v: &Value) -> Result<()> {
    match v {
        Value::Null => Ok(()),
        Value::String(s) if valid_date(s) => Ok(()),
        _ => Err(LinkError::invalid("due", "must be a date like 2026-11-04, or null")),
    }
}

fn check_statuses(list: &Value) -> Result<Vec<String>> {
    let items: Vec<String> = list.as_array().unwrap().iter().map(|s| s.as_str().unwrap().trim().to_string()).collect();
    let mut seen = std::collections::HashSet::new();
    for s in &items {
        if s.is_empty() {
            return Err(LinkError::invalid("statuses", "names cannot be blank"));
        }
        if !seen.insert(s.to_lowercase()) {
            return Err(LinkError::invalid("statuses", &format!("`{s}` appears twice")));
        }
    }
    Ok(items)
}

fn check_attr_schema(v: &Value) -> Result<()> {
    let Some(map) = v.as_object() else { return Err(LinkError::invalid("attributes", "must be an object")) };
    for (k, t) in map {
        let ok_key = !k.is_empty() && k.len() <= 40 && k.chars().next().unwrap().is_ascii_alphabetic()
            && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !ok_key {
            return Err(LinkError::invalid(&format!("attributes.{k}"), "names start with a letter and use letters, digits or _"));
        }
        if !matches!(t.as_str(), Some("text" | "number" | "date" | "boolean")) {
            return Err(LinkError::invalid(&format!("attributes.{k}"), "type must be text, number, date or boolean"));
        }
    }
    Ok(())
}

/// Validate custom attribute values against the project's schema. `null` removes a value.
fn check_attr_values(schema: &Value, values: &Value) -> Result<()> {
    let Some(map) = values.as_object() else { return Err(LinkError::invalid("attributes", "must be an object")) };
    for (k, v) in map {
        let field = format!("attributes.{k}");
        let Some(kind) = schema.get(k).and_then(|t| t.as_str()) else {
            return Err(LinkError::invalid(&field, "is not defined by the project"));
        };
        let ok = match (kind, v) {
            (_, Value::Null) => true,
            ("text", Value::String(s)) => s.chars().count() <= 2000,
            ("number", Value::Number(_)) => true,
            ("boolean", Value::Bool(_)) => true,
            ("date", Value::String(s)) => valid_date(s),
            _ => false,
        };
        if !ok {
            return Err(LinkError::invalid(&field, &format!("must be a {kind}")));
        }
    }
    Ok(())
}

fn load_owned(svc: &Services, ctx: &Ctx, collection: &str, id: &str, what: &str) -> Result<Value> {
    match svc.db()?.get(collection, id)? {
        Some(d) if str_of(&d, "owner") == Some(&ctx.subject) => Ok(d),
        _ => Err(LinkError::not_found(what)),
    }
}

fn last_status(project: &Value) -> String {
    project["statuses"].as_array().and_then(|s| s.last()).and_then(|s| s.as_str()).unwrap_or("Done").to_string()
}

fn owner_query(collection: &str, ctx: &Ctx) -> Query {
    Query::new(collection).eq("owner", ctx.subject.as_str())
}

// ---------- projects ----------

fn projects_create(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let statuses = match input.get("statuses") {
        Some(s) => check_statuses(s)?,
        None => DEFAULT_STATUSES.iter().map(|s| s.to_string()).collect(),
    };
    let attributes = input.get("attributes").cloned().unwrap_or_else(|| json!({}));
    check_attr_schema(&attributes)?;
    let project = json!({
        "id": svc.ids()?.new_id(), "owner": ctx.subject, "name": str_of(&input, "name").unwrap().trim(),
        "statuses": statuses, "attributes": attributes, "created_at": ctx.now_ms, "updated_at": ctx.now_ms
    });
    if project["name"].as_str() == Some("") {
        return Err(LinkError::invalid("name", "cannot be blank"));
    }
    svc.db()?.put("projects", project["id"].as_str().unwrap(), &project)?;
    svc.emit("project.created", &ctx.subject, json!({"project": project}))?;
    Ok(project)
}

fn projects_list(ctx: &Ctx, _input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let mut out = vec![];
    for mut p in db.query(&owner_query("projects", ctx).order("created_at", false))? {
        let n = db.query(&owner_query("tasks", ctx).eq("project_id", p["id"].clone()))?.len();
        p["task_count"] = json!(n);
        out.push(p);
    }
    Ok(json!(out))
}

fn projects_get(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    load_owned(svc, ctx, "projects", str_of(&input, "id").unwrap(), "project")
}

fn projects_update(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let mut p = load_owned(svc, ctx, "projects", str_of(&input, "id").unwrap(), "project")?;
    let tasks = db.query(&owner_query("tasks", ctx).eq("project_id", p["id"].clone()))?;
    if let Some(name) = str_of(&input, "name") {
        if name.trim().is_empty() {
            return Err(LinkError::invalid("name", "cannot be blank"));
        }
        p["name"] = json!(name.trim());
    }
    if let Some(list) = input.get("statuses") {
        let statuses = check_statuses(list)?;
        let missing: Vec<&str> = tasks
            .iter()
            .filter_map(|t| str_of(t, "status"))
            .filter(|s| !statuses.iter().any(|n| n == s))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        if !missing.is_empty() {
            return Err(LinkError::conflict(format!("tasks still use the status {}", missing.join(", "))));
        }
        p["statuses"] = json!(statuses);
    }
    if let Some(schema) = input.get("attributes") {
        check_attr_schema(schema)?;
        for (k, old_type) in p["attributes"].as_object().cloned().unwrap_or_default() {
            if schema.get(&k) != Some(&old_type) {
                let in_use = tasks.iter().any(|t| t["attributes"].get(&k).is_some_and(|v| !v.is_null()));
                if in_use {
                    return Err(LinkError::conflict(format!("attribute `{k}` has values on tasks and cannot be removed or retyped")));
                }
            }
        }
        p["attributes"] = schema.clone();
    }
    p["updated_at"] = json!(ctx.now_ms);
    db.put("projects", p["id"].as_str().unwrap(), &p)?;
    svc.emit("project.updated", &ctx.subject, json!({"project": p}))?;
    Ok(p)
}

fn projects_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let p = load_owned(svc, ctx, "projects", str_of(&input, "id").unwrap(), "project")?;
    if !db.query(&owner_query("tasks", ctx).eq("project_id", p["id"].clone()).limit(1))?.is_empty() {
        return Err(LinkError::conflict("the project still has tasks"));
    }
    db.delete("projects", p["id"].as_str().unwrap())?;
    svc.emit("project.deleted", &ctx.subject, json!({"id": p["id"]}))?;
    Ok(json!({"id": p["id"], "deleted": true}))
}

// ---------- tasks ----------

fn tasks_create(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let project = load_owned(svc, ctx, "projects", str_of(&input, "project_id").unwrap(), "project")?;
    let statuses: Vec<&str> = project["statuses"].as_array().unwrap().iter().filter_map(|s| s.as_str()).collect();
    let status = str_of(&input, "status").unwrap_or(statuses[0]);
    if !statuses.contains(&status) {
        return Err(LinkError::invalid("status", &format!("must be one of {}", statuses.join(", "))));
    }
    let title = str_of(&input, "title").unwrap().trim();
    if title.is_empty() {
        return Err(LinkError::invalid("title", "cannot be blank"));
    }
    let due = input.get("due").cloned().unwrap_or(Value::Null);
    check_due(&due)?;
    let attrs = input.get("attributes").cloned().unwrap_or_else(|| json!({}));
    check_attr_values(&project["attributes"], &attrs)?;
    let attrs: Map<String, Value> = attrs.as_object().unwrap().iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
    let done = status == last_status(&project);
    let task = json!({
        "id": svc.ids()?.new_id(), "owner": ctx.subject, "project_id": project["id"], "title": title,
        "description": str_of(&input, "description").unwrap_or(""), "status": status,
        "priority": input.get("priority").and_then(|p| p.as_i64()).unwrap_or(0), "due": due,
        "attributes": attrs, "completed_at": if done { json!(ctx.now_ms) } else { Value::Null },
        "created_at": ctx.now_ms, "updated_at": ctx.now_ms
    });
    svc.db()?.put("tasks", task["id"].as_str().unwrap(), &task)?;
    let task = present_task(task);
    svc.emit("task.created", &ctx.subject, json!({"task": task}))?;
    Ok(task)
}

fn tasks_get(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    Ok(present_task(load_owned(svc, ctx, "tasks", str_of(&input, "id").unwrap(), "task")?))
}

fn tasks_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let mut q = owner_query("tasks", ctx).order("created_at", false);
    if let Some(p) = str_of(&input, "project_id") {
        q = q.eq("project_id", p);
    }
    if let Some(s) = str_of(&input, "status") {
        q = q.eq("status", s);
    }
    if let Some(t) = str_of(&input, "q") {
        q = q.filter("title", FilterOp::Contains, json!(t));
    }
    q = q.limit(input.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize);
    Ok(json!(svc.db()?.query(&q)?.into_iter().map(present_task).collect::<Vec<_>>()))
}

fn tasks_update(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let mut t = load_owned(svc, ctx, "tasks", str_of(&input, "id").unwrap(), "task")?;
    let project = load_owned(svc, ctx, "projects", str_of(&t, "project_id").unwrap(), "project")?;
    let mut changes: Vec<&str> = vec![];

    if let Some(title) = str_of(&input, "title") {
        if title.trim().is_empty() {
            return Err(LinkError::invalid("title", "cannot be blank"));
        }
        t["title"] = json!(title.trim());
        changes.push("title");
    }
    if let Some(d) = str_of(&input, "description") {
        t["description"] = json!(d);
        changes.push("description");
    }
    if let Some(p) = input.get("priority") {
        t["priority"] = p.clone();
        changes.push("priority");
    }
    if let Some(due) = input.get("due") {
        check_due(due)?;
        t["due"] = due.clone();
        changes.push("due");
    }
    if let Some(patch) = input.get("attributes") {
        check_attr_values(&project["attributes"], patch)?;
        let mut merged = t["attributes"].as_object().cloned().unwrap_or_default();
        for (k, v) in patch.as_object().unwrap() {
            if v.is_null() {
                merged.remove(k);
            } else {
                merged.insert(k.clone(), v.clone());
            }
        }
        t["attributes"] = Value::Object(merged);
        changes.push("attributes");
    }
    if let Some(status) = str_of(&input, "status") {
        let allowed: Vec<&str> = project["statuses"].as_array().unwrap().iter().filter_map(|s| s.as_str()).collect();
        if !allowed.contains(&status) {
            return Err(LinkError::invalid("status", &format!("must be one of {}", allowed.join(", "))));
        }
        let was = str_of(&t, "status").unwrap().to_string();
        if was != status {
            let last = last_status(&project);
            if status == last {
                t["completed_at"] = json!(ctx.now_ms);
            } else if was == last {
                t["completed_at"] = Value::Null;
            }
            t["status"] = json!(status);
            changes.push("status");
        }
    }
    if !changes.is_empty() {
        t["updated_at"] = json!(ctx.now_ms);
        svc.db()?.put("tasks", t["id"].as_str().unwrap(), &t)?;
    }
    let t = present_task(t);
    if !changes.is_empty() {
        svc.emit("task.updated", &ctx.subject, json!({"task": t, "changes": changes}))?;
    }
    Ok(t)
}

fn tasks_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let t = load_owned(svc, ctx, "tasks", str_of(&input, "id").unwrap(), "task")?;
    let tid = t["id"].as_str().unwrap().to_string();
    let mut ops = vec![WriteOp::Delete { collection: "tasks".into(), id: tid.clone() }];
    for col in ["comments", "followups"] {
        for d in db.query(&owner_query(col, ctx).eq("task_id", tid.as_str()))? {
            ops.push(WriteOp::Delete { collection: col.into(), id: d["id"].as_str().unwrap().to_string() });
        }
    }
    db.batch(&ops)?;
    svc.emit("task.deleted", &ctx.subject, json!({"id": tid, "project_id": t["project_id"]}))?;
    Ok(json!({"id": tid, "deleted": true}))
}

// ---------- comments ----------

fn comments_add(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let task = load_owned(svc, ctx, "tasks", str_of(&input, "task_id").unwrap(), "task")?;
    let parent = match str_of(&input, "parent_id") {
        None => Value::Null,
        Some(pid) => {
            let p = load_owned(svc, ctx, "comments", pid, "parent comment")?;
            if p["task_id"] != task["id"] {
                return Err(LinkError::conflict("the parent comment belongs to a different task"));
            }
            if !p["parent_id"].is_null() {
                return Err(LinkError::conflict("replies cannot be replied to"));
            }
            json!(pid)
        }
    };
    let text = str_of(&input, "text").unwrap().trim();
    if text.is_empty() {
        return Err(LinkError::invalid("text", "cannot be blank"));
    }
    let c = json!({"id": svc.ids()?.new_id(), "owner": ctx.subject, "author": ctx.display, "task_id": task["id"],
        "parent_id": parent, "text": text, "created_at": ctx.now_ms});
    db.put("comments", c["id"].as_str().unwrap(), &c)?;
    svc.emit("comment.added", &ctx.subject, json!({"comment": c}))?;
    Ok(c)
}

fn comments_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let task_id = str_of(&input, "task_id").unwrap();
    load_owned(svc, ctx, "tasks", task_id, "task")?;
    Ok(json!(svc.db()?.query(&owner_query("comments", ctx).eq("task_id", task_id).order("created_at", false))?))
}

fn comments_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let c = load_owned(svc, ctx, "comments", str_of(&input, "id").unwrap(), "comment")?;
    let cid = c["id"].as_str().unwrap().to_string();
    let mut ops = vec![WriteOp::Delete { collection: "comments".into(), id: cid.clone() }];
    for r in db.query(&owner_query("comments", ctx).eq("parent_id", cid.as_str()))? {
        ops.push(WriteOp::Delete { collection: "comments".into(), id: r["id"].as_str().unwrap().to_string() });
    }
    db.batch(&ops)?;
    svc.emit("comment.deleted", &ctx.subject, json!({"id": cid, "task_id": c["task_id"]}))?;
    Ok(json!({"id": cid, "deleted": true}))
}

// ---------- follow-ups ----------

fn followups_add(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let task = load_owned(svc, ctx, "tasks", str_of(&input, "task_id").unwrap(), "task")?;
    let text = str_of(&input, "text").unwrap().trim();
    if text.is_empty() {
        return Err(LinkError::invalid("text", "cannot be blank"));
    }
    let f = json!({"id": svc.ids()?.new_id(), "owner": ctx.subject, "author": ctx.display, "task_id": task["id"], "text": text, "created_at": ctx.now_ms});
    svc.db()?.put("followups", f["id"].as_str().unwrap(), &f)?;
    svc.emit("followup.added", &ctx.subject, json!({"followup": f}))?;
    Ok(f)
}

fn followups_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let task_id = str_of(&input, "task_id").unwrap();
    load_owned(svc, ctx, "tasks", task_id, "task")?;
    Ok(json!(svc.db()?.query(&owner_query("followups", ctx).eq("task_id", task_id).order("created_at", false))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bands() {
        assert_eq!(priority_band(0), "None");
        assert_eq!(priority_band(1), "Low");
        assert_eq!(priority_band(3), "Low");
        assert_eq!(priority_band(4), "Medium");
        assert_eq!(priority_band(6), "Medium");
        assert_eq!(priority_band(7), "High");
        assert_eq!(priority_band(9), "High");
        assert_eq!(priority_band(10), "Urgent");
    }
    #[test]
    fn dates() {
        assert!(valid_date("2026-11-04"));
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("2026-02-29"));
        assert!(!valid_date("2026-13-01"));
        assert!(!valid_date("2026-1-01"));
        assert!(!valid_date("26-11-04"));
        assert!(!valid_date("2026-04-31"));
    }
}
