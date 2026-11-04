//! Plugins that add to, wrap, or decorate the task domain without the task plugin knowing about them:
//! audit (wrap), quota (wrap with veto), prefs (add), export (add route + UI slot), themes (data only).

use nuah_kernel::*;
use serde_json::{json, Value};

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

// ---------- audit: an append-only record of every change ----------

pub struct AuditPlugin;

impl Plugin for AuditPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"audit","version":"0.1.0","kind":"wrap","quality":"silver",
                "requires":{"ports":["db","ids"]},"contributes":{"ops":["audit.list"]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        // Before: remember what the entity looked like.
        a.before("snapshot-old", "*", -100, |ctx, spec, input, svc| {
            if spec.kind != OpKind::Command {
                return Ok(());
            }
            if let (Some(entity), Some(id)) = (&spec.entity, str_of(input, "id")) {
                if let Some(old) = svc.db()?.get(entity, id)? {
                    ctx.scratch_set("audit.old", old);
                }
            }
            Ok(())
        });
        // After: write one entry per successful change.
        a.after("record", "*", 100, |ctx, spec, input, result, svc| {
            let Some(entity) = &spec.entity else { return Ok(()) };
            if spec.kind != OpKind::Command {
                return Ok(());
            }
            let deleted = result.get("deleted") == Some(&json!(true));
            let entity_id = str_of(input, "id").or_else(|| str_of(result, "id")).unwrap_or("").to_string();
            let entry = json!({
                "id": svc.ids()?.new_id(), "owner": ctx.subject, "ts": ctx.now_ms, "op": spec.name,
                "entity": entity, "entity_id": entity_id, "request_id": ctx.request_id,
                "old": ctx.scratch_get("audit.old").unwrap_or(Value::Null),
                "new": if deleted { Value::Null } else { result.clone() }
            });
            svc.db()?.put("audit", entry["id"].as_str().unwrap(), &entry)
        });
        a.op(
            OpSpec::query("audit.list", "audit.read", "Changes made to your data, newest first.",
                json!({"type":"object","additionalProperties":false,"properties":{
                    "entity_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":500}}})),
            |ctx, input, svc| {
                let mut q = Query::new("audit").eq("owner", ctx.subject.as_str()).order("ts", true);
                if let Some(e) = str_of(&input, "entity_id") {
                    q = q.eq("entity_id", e);
                }
                q = q.limit(input.get("limit").and_then(|l| l.as_u64()).unwrap_or(100) as usize);
                Ok(json!(svc.db()?.query(&q)?))
            },
        );
        Ok(())
    }
}

// ---------- quota: a veto ----------

pub struct QuotaPlugin;

impl Plugin for QuotaPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"quota","version":"0.1.0","kind":"wrap","quality":"bronze",
                "requires":{"ports":["db"]},"contributes":{"ops":[]}})
            .to_string(),
        )
    }
    /// Settings: {"max_tasks": 1000}
    fn activate(&self, a: &mut Activation) -> Result<()> {
        let max = a.settings().get("max_tasks").and_then(|m| m.as_u64()).unwrap_or(1000) as usize;
        a.before("max-tasks", "tasks.create", 0, move |ctx, _spec, _input, svc| {
            let used = svc.db()?.query(&Query::new("tasks").eq("owner", ctx.subject.as_str()).limit(max + 1))?.len();
            if used >= max {
                return Err(LinkError::new("quota_exceeded", format!("the limit of {max} tasks is reached"))
                    .with_details(json!({"limit": max})));
            }
            Ok(())
        });
        Ok(())
    }
}

// ---------- prefs: per-user settings that follow the user across faces ----------

pub struct PrefsPlugin;

impl Plugin for PrefsPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"prefs","version":"0.1.0","kind":"domain","quality":"bronze",
                "requires":{"ports":["db"],"capabilities":["events"]},
                "contributes":{"ops":["prefs.get","prefs.set"]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.op(
            OpSpec::query("prefs.get", "prefs.read", "Your saved preferences.",
                json!({"type":"object","additionalProperties":false,"properties":{}})),
            |ctx, _input, svc| {
                let doc = svc.db()?.get("prefs", &ctx.subject)?;
                Ok(doc.map(|d| d["values"].clone()).unwrap_or_else(|| json!({})))
            },
        );
        a.op(
            OpSpec::command("prefs.set", "prefs.write", "Save one preference. A null value clears it.",
                json!({"type":"object","required":["key","value"],"additionalProperties":false,"properties":{
                    "key":{"type":"string","enum":["theme","density","locale"]},
                    "value":{"type":["string","null"],"maxLength":100}}}))
            .entity("prefs"),
            |ctx, input, svc| {
                let db = svc.db()?;
                let mut values = db.get("prefs", &ctx.subject)?.map(|d| d["values"].clone()).unwrap_or_else(|| json!({}));
                let key = str_of(&input, "key").unwrap();
                if input["value"].is_null() {
                    values.as_object_mut().unwrap().remove(key);
                } else {
                    values[key] = input["value"].clone();
                }
                db.put("prefs", &ctx.subject, &json!({"id": ctx.subject, "owner": ctx.subject, "values": values}))?;
                svc.emit("prefs.changed", &ctx.subject, json!({"values": values}))?;
                Ok(values)
            },
        );
        Ok(())
    }
}

// ---------- export: adds a route and a toolbar button ----------

pub struct ExportPlugin;

impl Plugin for ExportPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"export","version":"0.1.0","kind":"domain","quality":"bronze",
                "requires":{"ports":["db"]},
                "contributes":{"ops":[],"routes":["GET /x/export/madar.json"],
                    "slots":[{"slot":"toolbar","id":"export","label":"Export JSON","faces":["web"],
                        "action":{"type":"download","href":"/x/export/madar.json","filename":"madar-export.json"}}]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.route(
            RouteSpec { method: "GET".into(), path: "/x/export/madar.json".into(), permission: "tasks.read".into() },
            |ctx, _req, svc| {
                let db = svc.db()?;
                let mut out = serde_json::Map::new();
                for col in ["projects", "tasks", "comments", "followups"] {
                    out.insert(col.into(), json!(db.query(&Query::new(col).eq("owner", ctx.subject.as_str()).order("created_at", false))?));
                }
                Ok(RouteResponse {
                    status: 200,
                    content_type: "application/json".into(),
                    headers: vec![("Content-Disposition".into(), "attachment; filename=\"madar-export.json\"".into())],
                    body: serde_json::to_vec_pretty(&Value::Object(out)).unwrap(),
                })
            },
        );
        Ok(())
    }
}

// ---------- themes: face-only plugins that are pure data ----------

pub fn theme_plugin(id: &str, name: &str, tokens: Value) -> DataPlugin {
    DataPlugin(Manifest::parse(
        &json!({"id": format!("theme-{id}"), "version":"0.1.0","kind":"theme","runtime":"data",
            "contributes":{"assets":[{"kind":"theme","id":id,"name":name,"faces":["web"],"tokens":tokens}]}})
        .to_string(),
    ))
}

pub fn builtin_themes() -> Vec<DataPlugin> {
    vec![
        theme_plugin("paper", "Paper", json!({
            "bg":"#f4f5f2","surface":"#ffffff","ink":"#1b2321","muted":"#5d6a66","line":"#d3d9d5",
            "accent":"#0e7466","accent-soft":"#dcf1ed","danger":"#b42318","warn":"#b45309"})),
        theme_plugin("ink", "Ink", json!({
            "bg":"#10171a","surface":"#182126","ink":"#e6eeeb","muted":"#9db0ab","line":"#2b3a3f",
            "accent":"#46cdb5","accent-soft":"#12353a","danger":"#ff8f7f","warn":"#f2a24f"})),
    ]
}
