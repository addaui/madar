//! Notifications, as the example of a plugin-defined port.
//!
//! `notify` invents the port `notify.channel` (policy `many`: every channel gets every message) and
//! turns "a task was completed" into a message. It knows no channel by name. `notify-inbox` and
//! `notify-count` each fill the port; either one can be switched off without touching the other.

use nuah_kernel::*;
use serde_json::{json, Value};

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

pub struct NotifyPlugin;

impl Plugin for NotifyPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"notify","version":"0.1.0","kind":"domain","quality":"bronze",
                "requires":{"ports":["notify.channel"]},
                "defines":{"ports":[{"name":"notify.channel","policy":"many",
                    "doc":"Somewhere a message to a user can go. Every enabled channel receives every message.",
                    "methods":{"deliver":{"doc":"Hand one message to this channel.",
                        "input":{"type":"object","required":["subject","title"],"additionalProperties":false,"properties":{
                            "subject":{"type":"string","minLength":1},"title":{"type":"string","maxLength":300},
                            "body":{"type":"string","maxLength":2000},"ref":{"type":"string","maxLength":200}}}}}}]},
                "contributes":{"ops":[]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.on_event("task.updated", |event, svc| {
            let task = &event.data["task"];
            let changed_status = event.data["changes"].as_array().is_some_and(|c| c.iter().any(|x| x == "status"));
            if !changed_status || task["completed_at"].is_null() {
                return Ok(());
            }
            svc.port_call(
                "notify.channel",
                "deliver",
                json!({"subject": event.audience, "title": format!("Done: {}", task["title"].as_str().unwrap_or("a task")),
                       "ref": task["id"].as_str().unwrap_or("")}),
            )?;
            Ok(())
        });
        Ok(())
    }
}

/// A channel that keeps messages in the user's own inbox.
pub struct NotifyInboxPlugin;

impl Plugin for NotifyInboxPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"notify-inbox","version":"0.1.0","kind":"adapter","quality":"bronze",
                "requires":{"ports":["db","ids","clock"]},"data":{"owns":["inbox"]},
                "provides":[{"port":"notify.channel","priority":10}],
                "contributes":{"ops":["inbox.list","inbox.read"]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.provide("notify.channel", "deliver", |input, svc| {
            let id = svc.ids()?.new_id();
            let doc = json!({"id": id, "owner": input["subject"], "title": input["title"], "body": input.get("body").cloned().unwrap_or(Value::Null),
                             "ref": input.get("ref").cloned().unwrap_or(Value::Null), "ts": svc.clock()?.now_ms(), "read": false});
            svc.db()?.put("inbox", &id, &doc)?;
            Ok(json!({"id": id}))
        });
        a.op(
            OpSpec::query("inbox.list", "inbox.read", "Your messages, newest first.",
                json!({"type":"object","additionalProperties":false,"properties":{
                    "unread":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":200}}})),
            |ctx, input, svc| {
                let mut q = Query::new("inbox").eq("owner", ctx.subject.as_str()).order("ts", true);
                if input.get("unread") == Some(&json!(true)) {
                    q = q.eq("read", false);
                }
                q = q.limit(input.get("limit").and_then(|l| l.as_u64()).unwrap_or(50) as usize);
                Ok(json!(svc.db()?.query(&q)?))
            },
        );
        a.op(
            OpSpec::command("inbox.read", "inbox.write", "Mark one message, or all of them, as read.",
                json!({"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"}}})),
            |ctx, input, svc| {
                let db = svc.db()?;
                let docs = match str_of(&input, "id") {
                    Some(id) => db.get("inbox", id)?.into_iter().filter(|d| d["owner"] == json!(ctx.subject)).collect(),
                    None => db.query(&Query::new("inbox").eq("owner", ctx.subject.as_str()).eq("read", false))?,
                };
                let n = docs.len();
                for mut d in docs {
                    d["read"] = json!(true);
                    db.put("inbox", &d["id"].as_str().unwrap().to_string(), &d)?;
                }
                Ok(json!({"marked": n}))
            },
        );
        Ok(())
    }
}

/// A second, much smaller channel: counts messages per user. It exists to show that channels are
/// independent of each other.
pub struct NotifyCountPlugin;

impl Plugin for NotifyCountPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(
            &json!({"id":"notify-count","version":"0.1.0","kind":"adapter","quality":"bronze",
                "requires":{"ports":["db"]},"data":{"owns":["notify_counts"]},
                "provides":[{"port":"notify.channel","priority":20}],
                "contributes":{"ops":["notify.count"]}})
            .to_string(),
        )
    }
    fn activate(&self, a: &mut Activation) -> Result<()> {
        a.provide("notify.channel", "deliver", |input, svc| {
            let who = str_of(&input, "subject").unwrap_or("").to_string();
            let db = svc.db()?;
            let n = db.get("notify_counts", &who)?.and_then(|d| d["count"].as_u64()).unwrap_or(0) + 1;
            db.put("notify_counts", &who, &json!({"id": who, "count": n}))?;
            Ok(json!({"count": n}))
        });
        a.op(
            OpSpec::query("notify.count", "inbox.read", "How many messages you have received in total.",
                json!({"type":"object","additionalProperties":false,"properties":{}})),
            |ctx, _input, svc| {
                let n = svc.db()?.get("notify_counts", &ctx.subject)?.and_then(|d| d["count"].as_u64()).unwrap_or(0);
                Ok(json!({"count": n}))
            },
        );
        Ok(())
    }
}
