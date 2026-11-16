// SPDX-License-Identifier: Apache-2.0
//! The shapes of what Madar's operations return, as JSON Schema. The Core checks every output against its schema,
//! and the typed client the Face uses is generated from them (ADR 0059), so a result is described once, here.
//! Fields a result always has are `required`; a field that may be absent is not; extra fields are allowed so a plugin
//! can add one without breaking a Face.

use serde_json::{json, Value};

fn nullable(t: &str) -> Value {
    json!({"type": [t, "null"]})
}
fn list(of: Value) -> Value {
    json!({"type": "array", "items": of})
}
fn obj(required: &[&str], props: Value) -> Value {
    json!({"type": "object", "required": required, "properties": props})
}

const STR: &str = "string";
fn s() -> Value {
    json!({"type": "string"})
}
fn int() -> Value {
    json!({"type": "integer"})
}
fn num() -> Value {
    json!({"type": "number"})
}
fn boolean() -> Value {
    json!({"type": "boolean"})
}
fn strings() -> Value {
    list(s())
}

/// A custom field a project defines for its tasks.
pub fn attribute() -> Value {
    obj(&["key", "label", "type"], json!({"key": s(), "label": s(), "type": s(), "choices": strings()}))
}

pub fn project() -> Value {
    obj(
        &["id", "rev", "name", "statuses", "level", "space"],
        json!({
            "id": s(), "rev": int(), "name": s(), "key": nullable(STR), "level": s(), "space": s(), "created_by": s(), "can": strings(),
            "statuses": list(obj(&["id", "name"], json!({"id": s(), "name": s()}))),
            "attributes": list(attribute()),
        }),
    )
}

pub fn projects() -> Value {
    obj(&["projects"], json!({"projects": list(project())}))
}

pub fn members() -> Value {
    obj(&["members"], json!({"members": list(obj(&["subject", "level"], json!({"subject": s(), "display": nullable(STR), "level": s(), "via": s()})))}))
}

pub fn task() -> Value {
    obj(
        &["id", "rev", "project", "title", "status", "priority", "labels", "archived"],
        json!({
            "id": s(), "rev": int(), "project": s(), "number": nullable("integer"), "title": s(), "status": s(), "priority": int(), "band": s(),
            "due": nullable(STR), "assignee": nullable(STR), "labels": strings(), "parent": nullable(STR), "position": num(), "archived": boolean(),
            "created_by": s(), "created_at": int(), "completed_at": nullable("integer"), "can": strings(),
            "repeat": {"type": ["object", "null"], "properties": {"every": int(), "unit": s()}},
            "description": {"type": ["object", "null"]}, "custom": {"type": "object"},
        }),
    )
}

pub fn tasks() -> Value {
    obj(&["tasks"], json!({"tasks": list(task()), "next": nullable("integer")}))
}

/// A task as `tasks.my` shows it: with the project it belongs to and the bucket it falls in.
pub fn my_task() -> Value {
    let mut t = task();
    t["properties"]["project_name"] = s();
    t["properties"]["bucket"] = s();
    t
}

pub fn my_tasks() -> Value {
    obj(&["tasks", "today"], json!({"tasks": list(my_task()), "today": s()}))
}

pub fn focus() -> Value {
    obj(&["start", "also", "today"], json!({"start": list(my_task()), "also": list(my_task()), "open": int(), "today": s()}))
}

pub fn stats() -> Value {
    let counts = json!({"type": "object", "additionalProperties": int()});
    obj(
        &["total", "open", "done", "overdue", "by_status", "by_band", "completed_per_day"],
        json!({
            "total": int(), "open": int(), "done": int(), "overdue": int(), "today": s(), "by_status": counts, "by_band": counts,
            "completed_per_day": list(obj(&["date", "n"], json!({"date": s(), "n": int()}))),
        }),
    )
}

pub fn label() -> Value {
    obj(&["id", "name"], json!({"id": s(), "name": s(), "color": s()}))
}

pub fn labels() -> Value {
    obj(&["labels"], json!({"labels": list(label())}))
}

pub fn space() -> Value {
    obj(&["id", "name", "builtin", "role"], json!({"id": s(), "name": s(), "builtin": boolean(), "role": s()}))
}

pub fn spaces() -> Value {
    obj(&["spaces"], json!({"spaces": list(space())}))
}

pub fn space_features() -> Value {
    obj(&["features"], json!({"features": list(obj(&["id", "name", "allowed", "enabled"], json!({"id": s(), "name": s(), "allowed": boolean(), "enabled": boolean()})))}))
}

pub fn space_members() -> Value {
    obj(&["members"], json!({"members": list(obj(&["subject", "role"], json!({"subject": s(), "display": nullable(STR), "role": s()})))}))
}

pub fn inbox() -> Value {
    obj(
        &["messages", "unread"],
        json!({"unread": int(), "messages": list(obj(&["id", "text", "read", "at"], json!({"id": s(), "text": s(), "link": {}, "read": boolean(), "at": int()})))}),
    )
}

/// A page as the tree lists it (no body).
pub fn page_item() -> Value {
    obj(
        &["id", "rev", "title", "folder"],
        json!({
            "id": s(), "rev": int(), "title": s(), "folder": boolean(), "icon": nullable(STR), "parent": nullable(STR), "position": num(),
            "project": nullable(STR), "space": nullable(STR), "number": nullable("integer"), "settings": {"type": "object"},
            "created_at": int(), "updated_at": int(), "created_by": s(),
            "tags": json!({"type": "array", "items": {"type": "string"}}),
        }),
    )
}

pub fn page() -> Value {
    let mut p = page_item();
    p["required"] = json!(["id", "rev", "title", "folder", "body"]);
    p["properties"]["body"] = json!({"type": "object"});
    p
}

pub fn page_tags() -> Value {
    obj(&["tags"], json!({"tags": list(obj(&["tag", "pages"], json!({"tag": s(), "pages": int()})))}))
}

pub fn pages() -> Value {
    obj(&["pages"], json!({"pages": list(page_item())}))
}

pub fn page_tasks() -> Value {
    obj(
        &["items"],
        json!({"items": list(obj(&["page", "block", "text"], json!({"page": s(), "title": s(), "icon": nullable(STR), "block": s(), "text": s(), "project": nullable(STR), "project_name": nullable(STR), "checked": boolean(), "due": nullable(STR), "priority": nullable(STR), "notes": nullable(STR)})))}),
    )
}

pub fn page_styles() -> Value {
    obj(&["styles"], json!({"styles": list(obj(&["id", "name", "settings"], json!({"id": s(), "name": s(), "settings": {"type": "object"}})))}))
}

/// What a command returns when it has nothing to report: an empty object (the Core still checks that it is one).
pub fn done() -> Value {
    json!({"type": "object"})
}

/// The earlier pictures of a page, newest first, each with the first words of its text.
pub fn page_versions() -> Value {
    obj(&["versions"], json!({"versions": list(obj(&["id", "title"], json!({"id": s(), "at": nullable("number"), "by": nullable(STR), "title": s(), "edited_at": nullable("number"), "text": s()})))}))
}

/// One earlier picture of a page, with its body.
pub fn page_version() -> Value {
    obj(&["id", "title", "body"], json!({"id": s(), "at": nullable("number"), "by": nullable(STR), "title": s(), "body": {"type": "object"}}))
}

/// One saved page style.
pub fn page_style() -> Value {
    obj(&["id", "name", "settings"], json!({"id": s(), "name": s(), "settings": {"type": "object"}}))
}

pub fn removed() -> Value {
    obj(&["removed"], json!({"removed": int()}))
}

pub fn audit() -> Value {
    obj(
        &["entries"],
        json!({"next": {}, "entries": list(obj(&["id", "kind", "actor", "at"], json!({"id": s(), "kind": s(), "actor": s(), "at": int(), "data": {"type": "object"}})))}),
    )
}

pub fn search_items() -> Value {
    obj(
        &["items"],
        json!({"items": list(obj(&["kind", "id", "title"], json!({"kind": s(), "id": s(), "title": s(), "snippet": s(), "score": num(), "project": nullable(STR), "project_name": nullable(STR), "space": nullable(STR), "tags": json!({"type": "array", "items": {"type": "string"}})})))}),
    )
}

pub fn share() -> Value {
    obj(
        &["id", "kind", "title", "audience", "mode", "release", "include_children", "people"],
        json!({
            "id": s(), "kind": s(), "title": s(), "audience": s(), "mode": s(), "release": int(), "include_children": boolean(), "page": nullable(STR), "project": nullable(STR),
            "space": nullable(STR), "subdomain": nullable(STR), "created_at": int(), "created_by": s(), "pin": nullable(STR),
            "people": list(obj(&["subject"], json!({"subject": s(), "display": nullable(STR)}))),
        }),
    )
}

pub fn shares() -> Value {
    obj(&["shares"], json!({"shares": list(share())}))
}

pub fn share_options() -> Value {
    obj(&["accounts"], json!({"accounts": boolean(), "base_domain": nullable(STR)}))
}

pub fn share_releases() -> Value {
    obj(&["releases"], json!({"releases": list(obj(&["number", "at"], json!({"number": int(), "at": int(), "by": s(), "count": int(), "current": boolean()})))}))
}

pub fn share_status() -> Value {
    obj(&["mode", "release", "latest", "current", "changed"], json!({"mode": s(), "release": int(), "latest": int(), "current": boolean(), "changed": int()}))
}

pub fn share_site() -> Value {
    obj(&["share", "status"], json!({"share": {"anyOf": [share(), {"type": "null"}]}, "status": {"anyOf": [share_status(), {"type": "null"}]}, "admin": boolean()}))
}

pub fn share_opened() -> Value {
    obj(
        &["share", "tree"],
        json!({
            "share": obj(&["id", "kind", "title", "audience", "mode"], json!({"id": s(), "kind": s(), "title": s(), "audience": s(), "mode": s()})),
            "tree": list(obj(&["id", "title"], json!({"id": s(), "parent": nullable(STR), "title": s(), "icon": nullable(STR), "position": num(), "folder": boolean(), "group": int(), "group_name": nullable(STR)}))),
            "blocks": {"type": "array"},
            "page": {"anyOf": [obj(&["id", "title", "body"], json!({"id": s(), "title": s(), "icon": nullable(STR), "body": {"type": "object"}, "settings": {"type": "object"}, "folder": boolean()})), {"type": "null"}]},
        }),
    )
}

pub fn share_file() -> Value {
    obj(&["name", "type", "data"], json!({"name": s(), "type": s(), "size": int(), "data": s()}))
}
