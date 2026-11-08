// SPDX-License-Identifier: Apache-2.0
//! `files`: uploads. The bytes live behind the Extension point `files.store` (one provider), so where they
//! are kept (the database now, a disk or a bucket later) is a deployment choice. ADR 0025.

use crate::util::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use nuah_kernel::*;
use serde_json::{json, Value};

pub const FILES: &str = "files.files";
pub const BLOBS: &str = "files-db.blobs";
pub const USES: &str = "files.uses";
const DAY_MS: i64 = 86_400_000;
pub const MAX_BYTES: usize = 4 * 1024 * 1024;

/// What the bytes really are, by their first bytes. The declared type is never trusted.
fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) { Some("image/png") }
    else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { Some("image/jpeg") }
    else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") { Some("image/gif") }
    else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" { Some("image/webp") }
    else if b.starts_with(b"%PDF-") { Some("application/pdf") }
    else if !b.is_empty() && !b.contains(&0) && std::str::from_utf8(b).is_ok() { Some("text/plain") }
    else { None }
}

fn clean_name(n: &str) -> String {
    let base = n.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let s: String = base.chars().filter(|c| !c.is_control()).take(100).collect();
    if s.is_empty() { "file".into() } else { s }
}

/// May the caller read (or, with `write`, change) this file?
fn allowed(tx: &mut Tx, meta: &Doc, write: bool) -> bool {
    let me = tx.who().subject.clone();
    match meta.body["project"].as_str() {
        None => text(&meta.body, "owner") == me,
        Some(p) => {
            if write && text(&meta.body, "owner") == me {
                return true;
            }
            tx.call("projects.get", json!({"project": p})).ok().is_some_and(|v| {
                let need = if write { "projects.manage" } else { "projects.read" };
                v["can"].as_array().is_some_and(|c| c.iter().any(|x| x == need))
            })
        }
    }
}

fn info(d: &Doc) -> Value {
    json!({"id": d.id, "name": d.body["name"], "type": d.body["type"], "size": d.body["size"], "project": d.body["project"],
        "owner": d.body["owner"], "created_at": d.body["created_at"], "url": format!("/files/{}", d.id)})
}

pub struct Files;
impl Plugin for Files {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "files", "version": "0.1.0", "name": "Files", "namespaces": ["files"],
            "description": "Uploaded images, PDFs and text files, kept by whichever plugin provides files.store",
            "requires": {"plugins": ["projects"], "capabilities": ["call"], "extension_points": ["files.store"]},
            "defines": {"extension_points": {"files.store": {"policy": "single",
                "description": "Keep and return bytes. {action: put|get|delete, id, data (base64, for put)}; get answers {data}.",
                "input": {"type":"object","required":["action","id"]}}}},
            "data": {"collections": [FILES, USES], "version": 1, "indexes": [{"collection": FILES, "field": "owner"}, {"collection": FILES, "field": "project"}, {"collection": USES, "field": "from_key"}, {"collection": USES, "field": "file"}]},
            "listeners": [{"id": "files.track", "on": ["pages.*", "notes.*", "tasks.*", "discussion.*"], "handler": "files.track"},
                           {"id": "files.project_gone", "on": ["projects.deleted"], "handler": "files.project_gone"}],
            "operations": {
                "files.upload": {"kind": "command", "description": "Upload a file (base64, at most 4 MiB): an image, a PDF or plain text. With `project` it is shared with the project's members.",
                    "reasons": {"files.too_big": "That file is larger than 4 MiB", "files.bad_type": "Only images (PNG, JPEG, GIF, WebP), PDFs and plain text can be uploaded", "files.not_allowed": "You cannot add files to that project"},
                    "input": {"type":"object","required":["name","data"],"properties":{"name":{"type":"string","maxLength":200},"data":{"type":"string","maxLength":5900000},"project":{"type":"string"}},"additionalProperties":false},
                    "output": {"type":"object","required":["id","url"]}},
                "files.info": {"kind": "query", "description": "A file's name, type and size",
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}, "output": {"type":"object","required":["id"]}},
                "files.download": {"kind": "query", "description": "A file's bytes (base64) with its type; the server turns this into GET /files/{id}",
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}, "output": {"type":"object","required":["data","type"]}},
                "files.sweep": {"kind": "command", "description": "Delete your own uploads that no page, task or comment shows (older than `older_than_days`, default 1)",
                    "input": {"type":"object","properties":{"older_than_days":{"type":"integer","minimum":0,"maximum":365}},"additionalProperties":false},
                    "output": {"type":"object","required":["removed"]}},
                "files.remove": {"kind": "command", "description": "Delete a file (its uploader, or a project owner)",
                    "input": {"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("files.upload", |tx, i| {
            let bytes = STANDARD.decode(text(&i, "data")).map_err(|_| Error::invalid("data", "is not valid base64"))?;
            if bytes.len() > MAX_BYTES {
                return Err(Error::reason(Category::Invalid, "files.too_big", "That file is larger than 4 MiB"));
            }
            let kind = sniff(&bytes).ok_or_else(|| Error::reason(Category::Invalid, "files.bad_type", "Only images (PNG, JPEG, GIF, WebP), PDFs and plain text can be uploaded"))?;
            let project = i.get("project").and_then(|p| p.as_str()).map(String::from);
            if let Some(p) = &project {
                let ok = tx.call("projects.get", json!({"project": p})).ok().is_some_and(|v| v["can"].as_array().is_some_and(|c| c.iter().any(|x| x == "projects.write")));
                if !ok {
                    return Err(Error::reason(Category::Denied, "files.not_allowed", "You cannot add files to that project"));
                }
            }
            let me = tx.who().subject.clone();
            let now = tx.now();
            let d = tx.create(FILES, json!({"name": clean_name(text(&i, "name")), "type": kind, "size": bytes.len(), "project": project, "owner": me, "created_at": now}))?;
            tx.extension_call("files.store", json!({"action": "put", "id": d.id, "data": i["data"]}))?;
            Ok(info(&d))
        });
        b.op("files.info", |tx, i| {
            let d = tx.get(FILES, text(&i, "id"))?.filter(|d| !d.deleted).ok_or_else(|| Error::not_found("file"))?;
            if !allowed(tx, &d, false) { return Err(Error::not_found("file")); }
            Ok(info(&d))
        });
        b.op("files.download", |tx, i| {
            let d = tx.get(FILES, text(&i, "id"))?.filter(|d| !d.deleted).ok_or_else(|| Error::not_found("file"))?;
            if !allowed(tx, &d, false) { return Err(Error::not_found("file")); }
            let got = tx.extension_call("files.store", json!({"action": "get", "id": d.id}))?;
            Ok(json!({"name": d.body["name"], "type": d.body["type"], "size": d.body["size"], "data": got["data"]}))
        });
        // Keeps `files.uses` (which item shows which file) and, when an item is deleted, deletes the files
        // only it showed (ADR 0026). Safe to repeat: row ids come from both ends.
        b.listener("files.track", |tx, d| {
            let l = &d.event.data["refs"];
            let (kind, id) = (text(&l["from"], "type"), text(&l["from"], "id"));
            if l.is_null() || kind.is_empty() || id.is_empty() {
                return Ok(());
            }
            let from_key = format!("{kind}:{id}");
            let now_used: Vec<String> = l["to"].as_array().into_iter().flatten().filter(|t| text(t, "type") == "files.file").map(|t| text(t, "id").to_string()).collect();
            loop {
                let old = tx.query(USES, &Query::new().eq("from_key", from_key.as_str()).limit(200))?;
                if old.items.is_empty() { break; }
                for o in old.items { tx.delete(USES, &o.id)?; }
            }
            for f in &now_used {
                tx.put(USES, &format!("{from_key}>{f}"), json!({"from_key": from_key, "file": f}), Expect::Any)?;
            }
            if !d.event.kind.ends_with(".removed") {
                return Ok(());
            }
            // The item is gone. Its files go too, unless another item still shows them.
            for f in d.event.data["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str()) {
                if !tx.query(USES, &Query::new().eq("file", f).limit(1))?.items.is_empty() { continue; }
                let Some(meta) = tx.get(FILES, f)?.filter(|m| !m.deleted) else { continue };
                let same_place = match d.event.data["project"].as_str() {
                    Some(p) => meta.body["project"].as_str() == Some(p),
                    None => meta.body["project"].is_null() && text(&meta.body, "owner") == d.actor,
                };
                if same_place {
                    tx.extension_call("files.store", json!({"action": "delete", "id": meta.id}))?;
                    tx.delete(FILES, &meta.id)?;
                }
            }
            Ok(())
        });
        // A deleted project takes its uploads with it.
        b.listener("files.project_gone", |tx, d| {
            let project = text(&d.event.data, "project").to_string();
            loop {
                let page = tx.query(FILES, &Query::new().eq("project", project.as_str()).limit(100))?;
                let live: Vec<Doc> = page.items.into_iter().filter(|m| !m.deleted).collect();
                if live.is_empty() { return Ok(()); }
                for m in live {
                    tx.extension_call("files.store", json!({"action": "delete", "id": m.id}))?;
                    tx.delete(FILES, &m.id)?;
                }
            }
        });
        b.op("files.sweep", |tx, i| {
            let me = tx.who().subject.clone();
            let cutoff = tx.now() - i.get("older_than_days").and_then(|v| v.as_i64()).unwrap_or(1) * DAY_MS;
            let mut removed = 0;
            for m in tx.query(FILES, &Query::new().eq("owner", me.as_str()).limit(500))?.items {
                if m.deleted || m.body["created_at"].as_i64().unwrap_or(0) > cutoff { continue; }
                if !tx.query(USES, &Query::new().eq("file", m.id.as_str()).limit(1))?.items.is_empty() { continue; }
                tx.extension_call("files.store", json!({"action": "delete", "id": m.id}))?;
                tx.delete(FILES, &m.id)?;
                removed += 1;
            }
            Ok(json!({"removed": removed}))
        });
        b.op("files.remove", |tx, i| {
            let d = tx.get(FILES, text(&i, "id"))?.filter(|d| !d.deleted).ok_or_else(|| Error::not_found("file"))?;
            if !allowed(tx, &d, true) { return Err(Error::not_found("file")); }
            tx.extension_call("files.store", json!({"action": "delete", "id": d.id}))?;
            tx.delete(FILES, &d.id)?;
            Ok(json!({}))
        });
    }
}

/// The first provider of `files.store`: bytes kept as documents in the Data Port.
pub struct FilesDb;
impl Plugin for FilesDb {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "files-db", "version": "0.1.0", "name": "Files in the database", "namespaces": ["files-db"],
            "description": "Keeps uploaded bytes in the database. Swap for a disk or bucket provider for big deployments.",
            "requires": {"plugins": ["files"]},
            "provides": [{"extension_point": "files.store"}],
            "data": {"collections": [BLOBS], "version": 1}
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.provide("files.store", |tx, i| {
            let id = text(&i, "id").to_string();
            match text(&i, "action") {
                "put" => { tx.put(BLOBS, &id, json!({"data": i["data"]}), Expect::Any)?; Ok(json!({})) }
                "get" => Ok(json!({"data": tx.get(BLOBS, &id)?.filter(|d| !d.deleted).map(|d| d.body["data"].clone()).ok_or_else(|| Error::not_found("file"))?})),
                "delete" => { tx.delete(BLOBS, &id)?; Ok(json!({})) }
                _ => Err(Error::invalid("action", "is not put, get or delete")),
            }
        });
    }
}
