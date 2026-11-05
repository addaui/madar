//! The Madar task domain as one plugin: projects, tasks, comments (one level of replies),
//! follow-ups. It knows nothing about transports, auth, or which database it runs on.
//!
//! Vocabulary follows Madar's domain context: a Task has a Status drawn from its Project's list,
//! the last Status is the completion status, Priority is 0-10 with a derived band.

use nuah_kernel::*;
use serde_json::{json, Map, Value};

const OPS: [&str; 19] = [
    "projects.create", "projects.list", "projects.get", "projects.update", "projects.delete",
    "projects.share", "projects.unshare", "projects.members",
    "tasks.create", "tasks.get", "tasks.list", "tasks.update", "tasks.move", "tasks.delete",
    "comments.add", "comments.list", "comments.delete",
    "followups.add", "followups.list",
];

pub const DEFAULT_STATUSES: [&str; 4] = ["Backlog", "Planning", "In Progress", "Done"];

pub struct TasksPlugin;

impl Plugin for TasksPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({
                "id": "tasks", "version": "0.1.0", "description":"Projects, tasks, comments, follow-ups, sharing, board order and archive.", "quality": "silver",
                "requires": {"ports": ["db", "ids"], "capabilities": ["events"]},
                "data": {"owns": ["projects", "tasks", "comments", "followups", "memberships"], "version": 1,
                    "indexes": [{"collection":"memberships","field":"subject"},{"collection":"memberships","field":"project_id"},
                                {"collection":"tasks","field":"project_id"},{"collection":"comments","field":"task_id"},
                                {"collection":"followups","field":"task_id"}]},
                "contributes": {"ops": OPS, "events": ["project.created","project.updated","project.deleted","task.created","task.updated","task.deleted","comment.added","comment.deleted","followup.added","project.shared","project.unshared"]}
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
                "assignee":{"type":["string","null"],"maxLength":200},
                "attributes":{"type":"object"}}})).entity("tasks"), tasks_create);
        a.op(OpSpec::query("tasks.get", "tasks.read", "Get one task.", id.clone()), tasks_get);
        a.op(OpSpec::query("tasks.list", "tasks.read", "List tasks, optionally by project, status or title text.",
            json!({"type":"object","additionalProperties":false,"properties":{
                "project_id":{"type":"string"},"status":{"type":"string"},"q":{"type":"string","maxLength":200},
                "assignee":{"type":"string","maxLength":200,"description":"A subject, or `me`."},
                "archived":{"type":"boolean","description":"true lists only archived tasks; otherwise they are left out."},
                "limit":{"type":"integer","minimum":1,"maximum":500}}})), tasks_list);
        a.op(OpSpec::command("tasks.update", "tasks.write", "Change fields of a task. Moving it to the last status completes it.",
            json!({"type":"object","required":["id"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},
                "title":{"type":"string","minLength":1,"maxLength":200},
                "description":{"type":"string","maxLength":20000},
                "status":{"type":"string","minLength":1},
                "priority":{"type":"integer","minimum":0,"maximum":10},
                "due":{"type":["string","null"]},
                "assignee":{"type":["string","null"],"maxLength":200},
                "archived":{"type":"boolean"},
                "attributes":{"type":"object"},
                "expected_version":{"type":"integer","minimum":1}}})).entity("tasks"), tasks_update);
        a.op(OpSpec::command("tasks.move", "tasks.write", "Move a task to another status and/or place it right after another task in that column (no after_id puts it first).",
            json!({"type":"object","required":["id"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},"status":{"type":"string","minLength":1},
                "after_id":{"type":["string","null"],"minLength":1}}})).entity("tasks"), tasks_move);
        a.op(OpSpec::command("projects.share", "tasks.write", "Give someone access to a project (owner only). Roles: editor or viewer. Sharing again changes the role.",
            json!({"type":"object","required":["id","subject","role"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},"subject":{"type":"string","minLength":1,"maxLength":200},
                "role":{"type":"string","enum":["editor","viewer"]}}})).entity("projects"), projects_share);
        a.op(OpSpec::command("projects.unshare", "tasks.write", "Remove someone from a project. The owner can remove anyone; members can remove themselves. Tasks assigned to them become unassigned.",
            json!({"type":"object","required":["id","subject"],"additionalProperties":false,"properties":{
                "id":{"type":"string","minLength":1},"subject":{"type":"string","minLength":1,"maxLength":200}}})).entity("projects"), projects_unshare);
        a.op(OpSpec::query("projects.members", "tasks.read", "Who has access to a project, and as what.", id.clone()), projects_members);
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

    /// Version 1: sharing arrived. Every existing project gets its owner's membership, and tasks
    /// get a board position in the order they were created.
    fn migrate(&self, _from: u32, svc: &Services) -> Result<()> {
        let db = svc.db()?;
        for p in db.query(&Query::new("projects"))? {
            let pid = p["id"].as_str().unwrap_or_default().to_string();
            let owner = p["owner"].as_str().unwrap_or_default().to_string();
            let mid = format!("{pid}:{owner}");
            if db.get("memberships", &mid)?.is_none() {
                db.put("memberships", &mid, &json!({"id": mid, "project_id": pid, "subject": owner, "role": "owner", "created_at": p["created_at"]}))?;
            }
            let mut tasks = db.query(&Query::new("tasks").eq("project_id", pid.as_str()).order("created_at", false))?;
            let mut next: std::collections::HashMap<String, f64> = Default::default();
            tasks.sort_by(|a, b| (a["created_at"].as_i64(), a["id"].as_str()).cmp(&(b["created_at"].as_i64(), b["id"].as_str())));
            for mut t in tasks {
                if t.get("position").is_none() {
                    let n = next.entry(t["status"].as_str().unwrap_or("").to_string()).or_insert(0.0);
                    *n += 1.0;
                    t["position"] = json!(*n);
                    db.put("tasks", t["id"].as_str().unwrap(), &t)?;
                }
            }
        }
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
    // u32::parse would accept a leading `+`, so require plain digits everywhere else.
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
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

// ---------- access ----------
// A project belongs to its creator (role "owner") and to anyone it is shared with ("editor" or
// "viewer"). Access is one document per (project, person) in `memberships`; everything else
// (tasks, comments, follow-ups) is reached through its project.

fn member_id(project_id: &str, subject: &str) -> String {
    format!("{project_id}:{subject}")
}

fn role_of(svc: &Services, project_id: &str, subject: &str) -> Result<Option<String>> {
    Ok(svc.db()?.get("memberships", &member_id(project_id, subject))?.and_then(|m| str_of(&m, "role").map(String::from)))
}

/// The project, if the caller is a member. Writing needs more than a viewer. Not a member looks
/// the same as not existing, so ids of other people's projects stay private.
fn project_for(svc: &Services, ctx: &Ctx, id: &str, write: bool) -> Result<(Value, String)> {
    let Some(role) = role_of(svc, id, &ctx.subject)? else { return Err(LinkError::not_found("project")) };
    let Some(p) = svc.db()?.get("projects", id)? else { return Err(LinkError::not_found("project")) };
    if write && role == "viewer" {
        return Err(LinkError::new("permission_denied", "this project is shared with you as a viewer"));
    }
    Ok((p, role))
}

fn project_as_owner(svc: &Services, ctx: &Ctx, id: &str) -> Result<Value> {
    let (p, role) = project_for(svc, ctx, id, true)?;
    if role != "owner" {
        return Err(LinkError::new("permission_denied", "only the owner of the project can do this"));
    }
    Ok(p)
}

fn task_for(svc: &Services, ctx: &Ctx, id: &str, write: bool) -> Result<(Value, Value, String)> {
    let Some(t) = svc.db()?.get("tasks", id)? else { return Err(LinkError::not_found("task")) };
    let (p, role) = project_for(svc, ctx, str_of(&t, "project_id").unwrap_or(""), write).map_err(|e| if e.code == "not_found" { LinkError::not_found("task") } else { e })?;
    Ok((t, p, role))
}

fn members_of(svc: &Services, project_id: &str) -> Result<Vec<Value>> {
    svc.db()?.query(&Query::new("memberships").eq("project_id", project_id).order("created_at", false))
}

/// Tell everyone who has access to the project (each hears it on their own Pulse).
fn emit_members(svc: &Services, project_id: &str, kind: &str, data: Value) -> Result<()> {
    for m in members_of(svc, project_id)? {
        svc.emit(kind, str_of(&m, "subject").unwrap_or(""), data.clone())?;
    }
    Ok(())
}

fn last_status(project: &Value) -> String {
    project["statuses"].as_array().and_then(|s| s.last()).and_then(|s| s.as_str()).unwrap_or("Done").to_string()
}

fn position_of(t: &Value) -> f64 {
    t["position"].as_f64().or_else(|| t["created_at"].as_f64()).unwrap_or(0.0)
}

fn sort_by_position(v: &mut [Value]) {
    v.sort_by(|a, b| {
        position_of(a).partial_cmp(&position_of(b)).unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a["created_at"].as_i64().cmp(&b["created_at"].as_i64()))
            .then_with(|| str_of(a, "id").cmp(&str_of(b, "id")))
    });
}

fn check_assignee(svc: &Services, project_id: &str, v: &Value) -> Result<()> {
    match v {
        Value::Null => Ok(()),
        Value::String(s) if role_of(svc, project_id, s)?.is_some() => Ok(()),
        _ => Err(LinkError::invalid("assignee", "must be someone who has access to the project")),
    }
}

fn column(svc: &Services, project_id: &str, status: &str) -> Result<Vec<Value>> {
    let mut v: Vec<Value> = svc.db()?.query(&Query::new("tasks").eq("project_id", project_id).eq("status", status))?
        .into_iter().filter(|t| t["archived"] != json!(true)).collect();
    sort_by_position(&mut v);
    Ok(v)
}

/// Move a task into `status`, keeping `completed_at` in step with the last status.
fn set_status(t: &mut Value, project: &Value, status: &str, now: i64) {
    let was = str_of(t, "status").unwrap_or("").to_string();
    if was == status {
        return;
    }
    let last = last_status(project);
    if status == last {
        t["completed_at"] = json!(now);
    } else if was == last {
        t["completed_at"] = Value::Null;
    }
    t["status"] = json!(status);
}

fn bump(t: &mut Value, now: i64) {
    t["updated_at"] = json!(now);
    t["version"] = json!(t.get("version").and_then(|v| v.as_i64()).unwrap_or(1) + 1);
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
    let pid = project["id"].as_str().unwrap();
    let db = svc.db()?;
    db.put("projects", pid, &project)?;
    db.put("memberships", &member_id(pid, &ctx.subject),
        &json!({"id": member_id(pid, &ctx.subject), "project_id": pid, "subject": ctx.subject, "role": "owner", "created_at": ctx.now_ms}))?;
    svc.emit("project.created", &ctx.subject, json!({"project": project}))?;
    Ok(project)
}

fn projects_list(ctx: &Ctx, _input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let mut out = vec![];
    for m in db.query(&Query::new("memberships").eq("subject", ctx.subject.as_str()))? {
        let Some(mut p) = db.get("projects", str_of(&m, "project_id").unwrap_or(""))? else { continue };
        let n = db.query(&Query::new("tasks").eq("project_id", p["id"].clone()))?.iter().filter(|t| t["archived"] != json!(true)).count();
        p["task_count"] = json!(n);
        p["role"] = m["role"].clone();
        out.push(p);
    }
    out.sort_by(|a, b| (a["created_at"].as_i64(), str_of(a, "id")).cmp(&(b["created_at"].as_i64(), str_of(b, "id"))));
    Ok(json!(out))
}

fn projects_get(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let (mut p, role) = project_for(svc, ctx, str_of(&input, "id").unwrap(), false)?;
    p["role"] = json!(role);
    Ok(p)
}

fn projects_update(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let mut p = project_as_owner(svc, ctx, str_of(&input, "id").unwrap())?;
    let tasks = db.query(&Query::new("tasks").eq("project_id", p["id"].clone()))?;
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
    emit_members(svc, p["id"].as_str().unwrap(), "project.updated", json!({"project": p}))?;
    Ok(p)
}

fn projects_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let p = project_as_owner(svc, ctx, str_of(&input, "id").unwrap())?;
    let pid = p["id"].as_str().unwrap().to_string();
    if !db.query(&Query::new("tasks").eq("project_id", pid.as_str()).limit(1))?.is_empty() {
        return Err(LinkError::conflict("the project still has tasks"));
    }
    let members = members_of(svc, &pid)?;
    let mut ops = vec![WriteOp::Delete { collection: "projects".into(), id: pid.clone() }];
    ops.extend(members.iter().map(|m| WriteOp::Delete { collection: "memberships".into(), id: str_of(m, "id").unwrap_or("").to_string() }));
    db.batch(&ops)?;
    for m in members {
        svc.emit("project.deleted", str_of(&m, "subject").unwrap_or(""), json!({"id": pid}))?;
    }
    Ok(json!({"id": pid, "deleted": true}))
}

fn projects_share(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let p = project_as_owner(svc, ctx, str_of(&input, "id").unwrap())?;
    let pid = p["id"].as_str().unwrap();
    let who = str_of(&input, "subject").unwrap().trim().to_string();
    if who.is_empty() {
        return Err(LinkError::invalid("subject", "cannot be blank"));
    }
    if role_of(svc, pid, &who)?.as_deref() == Some("owner") {
        return Err(LinkError::conflict("that person already owns the project"));
    }
    let role = str_of(&input, "role").unwrap();
    let m = json!({"id": member_id(pid, &who), "project_id": pid, "subject": who, "role": role, "created_at": ctx.now_ms});
    svc.db()?.put("memberships", &member_id(pid, &who), &m)?;
    emit_members(svc, pid, "project.shared", json!({"project": p, "subject": who, "role": role}))?;
    Ok(m)
}

fn projects_unshare(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let (p, role) = project_for(svc, ctx, str_of(&input, "id").unwrap(), false)?;
    let pid = p["id"].as_str().unwrap().to_string();
    let who = str_of(&input, "subject").unwrap().trim().to_string();
    if role != "owner" && who != ctx.subject {
        return Err(LinkError::new("permission_denied", "you can only remove yourself from a project you do not own"));
    }
    match role_of(svc, &pid, &who)?.as_deref() {
        None => return Err(LinkError::not_found("member")),
        Some("owner") => return Err(LinkError::conflict("the owner cannot be removed; delete the project instead")),
        _ => {}
    }
    let audience: Vec<String> = members_of(svc, &pid)?.iter().filter_map(|m| str_of(m, "subject").map(String::from)).collect();
    db.delete("memberships", &member_id(&pid, &who))?;
    let mut freed = vec![];
    for mut t in db.query(&Query::new("tasks").eq("project_id", pid.as_str()).eq("assignee", who.as_str()))? {
        t["assignee"] = Value::Null;
        bump(&mut t, ctx.now_ms);
        db.put("tasks", t["id"].as_str().unwrap(), &t)?;
        freed.push(t);
    }
    for who_hears in &audience {
        svc.emit("project.unshared", who_hears, json!({"project_id": pid, "subject": who}))?;
        // the person who left learns only that they left, not what the tasks look like now
        if *who_hears != who {
            for t in &freed {
                svc.emit("task.updated", who_hears, json!({"task": present_task(t.clone()), "changes": ["assignee"]}))?;
            }
        }
    }
    Ok(json!({"project_id": pid, "subject": who, "removed": true}))
}

fn projects_members(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let (p, _) = project_for(svc, ctx, str_of(&input, "id").unwrap(), false)?;
    Ok(json!(members_of(svc, p["id"].as_str().unwrap())?))
}

// ---------- tasks ----------

fn tasks_create(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let (project, _) = project_for(svc, ctx, str_of(&input, "project_id").unwrap(), true)?;
    let pid = project["id"].as_str().unwrap();
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
    let assignee = input.get("assignee").cloned().unwrap_or(Value::Null);
    check_assignee(svc, pid, &assignee)?;
    let attrs = input.get("attributes").cloned().unwrap_or_else(|| json!({}));
    check_attr_values(&project["attributes"], &attrs)?;
    let attrs: Map<String, Value> = attrs.as_object().unwrap().iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
    let done = status == last_status(&project);
    let position = column(svc, pid, status)?.last().map(|t| position_of(t) + 1.0).unwrap_or(1.0);
    let task = json!({
        "id": svc.ids()?.new_id(), "owner": ctx.subject, "project_id": project["id"], "title": title,
        "description": str_of(&input, "description").unwrap_or(""), "status": status,
        "priority": input.get("priority").and_then(|p| p.as_i64()).unwrap_or(0), "due": due,
        "assignee": assignee, "archived": false, "position": position,
        "attributes": attrs, "completed_at": if done { json!(ctx.now_ms) } else { Value::Null },
        "created_at": ctx.now_ms, "updated_at": ctx.now_ms, "version": 1
    });
    svc.db()?.put("tasks", task["id"].as_str().unwrap(), &task)?;
    let task = present_task(task);
    emit_members(svc, pid, "task.created", json!({"task": task}))?;
    Ok(task)
}

fn tasks_get(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    Ok(present_task(task_for(svc, ctx, str_of(&input, "id").unwrap(), false)?.0))
}

fn tasks_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let single = str_of(&input, "project_id");
    let pids: Vec<String> = match single {
        Some(p) => vec![project_for(svc, ctx, p, false)?.0["id"].as_str().unwrap().to_string()],
        None => db.query(&Query::new("memberships").eq("subject", ctx.subject.as_str()))?
            .iter().filter_map(|m| str_of(m, "project_id").map(String::from)).collect(),
    };
    let want_archived = input.get("archived") == Some(&json!(true));
    let assignee = str_of(&input, "assignee").map(|a| if a == "me" { ctx.subject.clone() } else { a.to_string() });
    let mut all = vec![];
    for pid in pids {
        let mut q = Query::new("tasks").eq("project_id", pid.as_str());
        if let Some(s) = str_of(&input, "status") {
            q = q.eq("status", s);
        }
        if let Some(a) = &assignee {
            q = q.eq("assignee", a.as_str());
        }
        if let Some(t) = str_of(&input, "q") {
            q = q.filter("title", FilterOp::Contains, json!(t));
        }
        all.extend(db.query(&q)?.into_iter().filter(|t| (t["archived"] == json!(true)) == want_archived));
    }
    if single.is_some() {
        sort_by_position(&mut all);
    } else {
        all.sort_by(|a, b| (a["created_at"].as_i64(), str_of(a, "id")).cmp(&(b["created_at"].as_i64(), str_of(b, "id"))));
    }
    all.truncate(input.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize);
    Ok(json!(all.into_iter().map(present_task).collect::<Vec<_>>()))
}

fn tasks_update(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let (mut t, project, _) = task_for(svc, ctx, str_of(&input, "id").unwrap(), true)?;
    let pid = project["id"].as_str().unwrap().to_string();
    let mut changes: Vec<&str> = vec![];
    if t["archived"] == json!(true) && input.as_object().unwrap().keys().any(|k| !["id", "archived", "expected_version"].contains(&k.as_str())) {
        return Err(LinkError::conflict("archived tasks cannot be changed; restore the task first"));
    }
    // Optimistic concurrency: a face that edited a stale copy is told, instead of silently overwriting.
    if let Some(expected) = input.get("expected_version").and_then(|v| v.as_i64()) {
        let current = t.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
        if expected != current {
            return Err(LinkError::conflict("the task was changed by someone else; reload and try again")
                .with_details(json!({"current_version": current})));
        }
    }

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
    if let Some(a) = input.get("assignee") {
        check_assignee(svc, &pid, a)?;
        if t.get("assignee") != Some(a) {
            t["assignee"] = a.clone();
            changes.push("assignee");
        }
    }
    if let Some(Value::Bool(flag)) = input.get("archived") {
        if (t["archived"] == json!(true)) != *flag {
            t["archived"] = json!(flag);
            changes.push("archived");
        }
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
        if str_of(&t, "status") != Some(status) {
            set_status(&mut t, &project, status, ctx.now_ms);
            t["position"] = json!(column(svc, &pid, status)?.last().map(|x| position_of(x) + 1.0).unwrap_or(1.0));
            changes.push("status");
        }
    }
    if !changes.is_empty() {
        bump(&mut t, ctx.now_ms);
        svc.db()?.put("tasks", t["id"].as_str().unwrap(), &t)?;
    }
    let t = present_task(t);
    if !changes.is_empty() {
        emit_members(svc, &pid, "task.updated", json!({"task": t, "changes": changes}))?;
    }
    Ok(t)
}

fn tasks_move(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let (mut t, project, _) = task_for(svc, ctx, str_of(&input, "id").unwrap(), true)?;
    let pid = project["id"].as_str().unwrap().to_string();
    let tid = t["id"].as_str().unwrap().to_string();
    let was_status = str_of(&t, "status").unwrap_or("").to_string();
    let status = str_of(&input, "status").unwrap_or(&was_status).to_string();
    let allowed: Vec<&str> = project["statuses"].as_array().unwrap().iter().filter_map(|s| s.as_str()).collect();
    if !allowed.contains(&status.as_str()) {
        return Err(LinkError::invalid("status", &format!("must be one of {}", allowed.join(", "))));
    }
    if t["archived"] == json!(true) {
        return Err(LinkError::conflict("archived tasks cannot be moved; restore the task first"));
    }
    let mut col: Vec<Value> = column(svc, &pid, &status)?.into_iter().filter(|x| x["id"] != json!(tid)).collect();
    let at = match input.get("after_id") {
        Some(Value::String(after)) => match col.iter().position(|x| x["id"] == json!(after)) {
            Some(i) => i + 1,
            None => return Err(LinkError::invalid("after_id", "must be a task in the target column")),
        },
        _ => 0,
    };
    let prev = (at > 0).then(|| position_of(&col[at - 1]));
    let next = col.get(at).map(position_of);
    let pos = match (prev, next) {
        (None, None) => 1.0,
        (None, Some(n)) => n - 1.0,
        (Some(p), None) => p + 1.0,
        (Some(p), Some(n)) => (p + n) / 2.0,
    };
    let crowded = matches!((prev, next), (Some(p), Some(n)) if n - p < 1e-6);
    let mut changes: Vec<&str> = vec![];
    let mut renumbered: Vec<Value> = vec![];
    if was_status != status {
        set_status(&mut t, &project, &status, ctx.now_ms);
        changes.push("status");
    }
    if crowded {
        // The gap ran out: number the whole column again, with the moved task in its new place.
        t["position"] = json!(0.0);
        col.insert(at, t.clone());
        for (i, mut x) in col.into_iter().enumerate() {
            let n = (i + 1) as f64;
            if x["id"] == json!(tid) {
                t["position"] = json!(n);
            } else if position_of(&x) != n {
                x["position"] = json!(n);
                bump(&mut x, ctx.now_ms); // other members' copies are now stale, and editors must be able to tell
                db.put("tasks", x["id"].as_str().unwrap(), &x)?;
                renumbered.push(x);
            }
        }
        changes.push("position");
    } else if t.get("position").and_then(|p| p.as_f64()) != Some(pos) {
        t["position"] = json!(pos);
        changes.push("position");
    }
    if !changes.is_empty() {
        bump(&mut t, ctx.now_ms);
        db.put("tasks", &tid, &t)?;
    }
    let t = present_task(t);
    if !changes.is_empty() {
        emit_members(svc, &pid, "task.updated", json!({"task": t, "changes": changes}))?;
    }
    for x in renumbered {
        emit_members(svc, &pid, "task.updated", json!({"task": present_task(x), "changes": ["position"]}))?;
    }
    Ok(t)
}

fn tasks_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let (t, _, _) = task_for(svc, ctx, str_of(&input, "id").unwrap(), true)?;
    let tid = t["id"].as_str().unwrap().to_string();
    let mut ops = vec![WriteOp::Delete { collection: "tasks".into(), id: tid.clone() }];
    for col in ["comments", "followups"] {
        for d in db.query(&Query::new(col).eq("task_id", tid.as_str()))? {
            ops.push(WriteOp::Delete { collection: col.into(), id: d["id"].as_str().unwrap().to_string() });
        }
    }
    db.batch(&ops)?;
    emit_members(svc, t["project_id"].as_str().unwrap_or(""), "task.deleted", json!({"id": tid, "project_id": t["project_id"]}))?;
    Ok(json!({"id": tid, "deleted": true}))
}

// ---------- comments ----------

fn comments_add(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let (task, _, _) = task_for(svc, ctx, str_of(&input, "task_id").unwrap(), true)?;
    let parent = match str_of(&input, "parent_id") {
        None => Value::Null,
        Some(pid) => {
            let Some(p) = db.get("comments", pid)? else { return Err(LinkError::not_found("parent comment")) };
            if p["task_id"] != task["id"] {
                // Only say "different task" when the caller can see that task; otherwise it looks missing.
                return Err(if task_for(svc, ctx, str_of(&p, "task_id").unwrap_or(""), false).is_ok() {
                    LinkError::conflict("the parent comment belongs to a different task")
                } else {
                    LinkError::not_found("parent comment")
                });
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
    emit_members(svc, task["project_id"].as_str().unwrap_or(""), "comment.added", json!({"comment": c}))?;
    Ok(c)
}

fn comments_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let task_id = str_of(&input, "task_id").unwrap();
    task_for(svc, ctx, task_id, false)?;
    Ok(json!(svc.db()?.query(&Query::new("comments").eq("task_id", task_id).order("created_at", false))?))
}

fn comments_delete(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let db = svc.db()?;
    let Some(c) = db.get("comments", str_of(&input, "id").unwrap())? else { return Err(LinkError::not_found("comment")) };
    let (task, _, role) = task_for(svc, ctx, str_of(&c, "task_id").unwrap_or(""), true).map_err(|e| if e.code == "not_found" { LinkError::not_found("comment") } else { e })?;
    if str_of(&c, "owner") != Some(&ctx.subject) && role != "owner" {
        return Err(LinkError::new("permission_denied", "only the author or the project owner can delete a comment"));
    }
    let cid = c["id"].as_str().unwrap().to_string();
    let mut ops = vec![WriteOp::Delete { collection: "comments".into(), id: cid.clone() }];
    for r in db.query(&Query::new("comments").eq("parent_id", cid.as_str()))? {
        ops.push(WriteOp::Delete { collection: "comments".into(), id: r["id"].as_str().unwrap().to_string() });
    }
    db.batch(&ops)?;
    emit_members(svc, task["project_id"].as_str().unwrap_or(""), "comment.deleted", json!({"id": cid, "task_id": c["task_id"]}))?;
    Ok(json!({"id": cid, "deleted": true}))
}

// ---------- follow-ups ----------

fn followups_add(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let (task, _, _) = task_for(svc, ctx, str_of(&input, "task_id").unwrap(), true)?;
    let text = str_of(&input, "text").unwrap().trim();
    if text.is_empty() {
        return Err(LinkError::invalid("text", "cannot be blank"));
    }
    let f = json!({"id": svc.ids()?.new_id(), "owner": ctx.subject, "author": ctx.display, "task_id": task["id"], "text": text, "created_at": ctx.now_ms});
    svc.db()?.put("followups", f["id"].as_str().unwrap(), &f)?;
    emit_members(svc, task["project_id"].as_str().unwrap_or(""), "followup.added", json!({"followup": f}))?;
    Ok(f)
}

fn followups_list(ctx: &Ctx, input: Value, svc: &Services) -> Result<Value> {
    let task_id = str_of(&input, "task_id").unwrap();
    task_for(svc, ctx, task_id, false)?;
    Ok(json!(svc.db()?.query(&Query::new("followups").eq("task_id", task_id).order("created_at", false))?))
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
        assert!(!valid_date("+026-+1-+1"));
    }
}
