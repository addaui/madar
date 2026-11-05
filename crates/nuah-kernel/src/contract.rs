//! Generated faces start here. Everything in this file reads the core's `describe` answer and
//! nothing else, so it works for any distribution and any plugin set: an OpenAPI document, a typed
//! TypeScript client, a list of tools for an AI agent, and the argument parser of a generic CLI.
//! None of it knows what a task is.

use serde_json::{json, Map, Value};

fn ops(describe: &Value) -> Vec<&Value> {
    let mut v: Vec<&Value> = describe["ops"]
        .as_array()
        .map(|a| a.iter().filter(|o| o["allowed"] != json!(false)).collect())
        .unwrap_or_default();
    v.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    v
}

fn object_schema(input: &Value) -> Value {
    if input.is_object() && input.get("type").is_some() {
        input.clone()
    } else {
        json!({"type": "object"})
    }
}

// ---------- OpenAPI ----------

/// An OpenAPI 3.1 document: one path per operation the caller may use.
pub fn openapi(describe: &Value) -> Value {
    let error = json!({"description": "A typed error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}});
    let mut paths = Map::new();
    for o in ops(describe) {
        let name = o["name"].as_str().unwrap_or("");
        let command = o["kind"] == "command";
        let mut params = vec![json!({"name": "X-Nuah-Face", "in": "header", "required": true, "schema": {"type": "string"},
            "description": "Which face is calling, for example web, cli or agent."})];
        if command {
            params.push(json!({"name": "Idempotency-Key", "in": "header", "required": false, "schema": {"type": "string"},
                "description": "Repeating a call with the same key and input returns the first answer instead of doing the work twice."}));
        }
        paths.insert(
            format!("/link/call/{name}"),
            json!({"post": {
                "operationId": name, "summary": o["doc"], "tags": [o["plugin"]],
                "x-kind": o["kind"], "x-permission": o["permission"],
                "parameters": params,
                "requestBody": {"required": true, "content": {"application/json": {"schema": object_schema(&o["input"])}}},
                "responses": {
                    "200": {"description": "Done", "content": {"application/json": {"schema": {"type": "object",
                        "properties": {"ok": {"const": true}, "data": {}, "replayed": {"type": "boolean"}}}}}},
                    "400": error, "401": error, "403": error, "404": error, "409": error, "429": error}}}),
        );
    }
    paths.insert(
        "/pulse".into(),
        json!({"get": {"operationId": "pulse", "summary": "Server-sent events: everything that changed for the caller, in order. Resume with ?after=<seq> or Last-Event-ID.",
            "parameters": [{"name": "after", "in": "query", "schema": {"type": "integer"}}],
            "responses": {"200": {"description": "text/event-stream", "content": {"text/event-stream": {"schema": {"type": "string"}}}}}}}),
    );
    json!({
        "openapi": "3.1.0",
        "info": {"title": format!("Nu'ah link: profile {}", describe["profile"].as_str().unwrap_or("")),
                 "version": describe["contract"].as_str().unwrap_or("0")},
        "servers": [{"url": "/"}],
        "security": [{"bearer": []}],
        "paths": paths,
        "components": {
            "securitySchemes": {"bearer": {"type": "http", "scheme": "bearer"}},
            "schemas": {"Error": {"type": "object", "required": ["ok", "error"], "properties": {
                "ok": {"const": false},
                "error": {"type": "object", "required": ["code", "message"], "properties": {
                    "code": {"type": "string", "description": "Stable: unauthenticated, permission_denied, not_found, unknown_op, invalid_input, conflict, idempotency_conflict, quota_exceeded, unavailable, internal"},
                    "message": {"type": "string"}, "details": {}}}}}}}
    })
}

// ---------- agent tools ----------

/// Tool definitions in the shape agent protocols use: a name, a description and an input schema.
/// Tool names cannot contain dots, so `tasks.create` becomes `tasks_create`.
pub fn tool_definitions(describe: &Value) -> Value {
    json!(ops(describe)
        .into_iter()
        .map(|o| {
            let name = o["name"].as_str().unwrap_or("");
            json!({
                "name": name.replace('.', "_"),
                "op": name,
                "description": format!("{} (needs permission {})", o["doc"].as_str().unwrap_or(""), o["permission"].as_str().unwrap_or("")),
                "inputSchema": object_schema(&o["input"]),
                "annotations": {"readOnlyHint": o["kind"] == "query"}
            })
        })
        .collect::<Vec<_>>())
}

// ---------- TypeScript ----------

fn ts_type(s: &Value) -> String {
    let Some(o) = s.as_object() else { return "unknown".into() };
    if let Some(options) = o.get("enum").and_then(|e| e.as_array()) {
        return options.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(" | ");
    }
    let one = |t: &str| -> String {
        match t {
            "string" => "string".into(),
            "integer" | "number" => "number".into(),
            "boolean" => "boolean".into(),
            "null" => "null".into(),
            "array" => format!("{}[]", o.get("items").map(|i| paren(ts_type(i))).unwrap_or_else(|| "unknown".into())),
            "object" => match o.get("properties").and_then(|p| p.as_object()) {
                Some(props) => {
                    let required: Vec<&str> = o.get("required").and_then(|r| r.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
                    let fields: Vec<String> = props
                        .iter()
                        .map(|(k, v)| format!("{}{}: {}", json!(k), if required.contains(&k.as_str()) { "" } else { "?" }, ts_type(v)))
                        .collect();
                    let open = if o.get("additionalProperties") == Some(&json!(false)) { "" } else { "; [key: string]: unknown" };
                    format!("{{ {}{} }}", fields.join("; "), open)
                }
                None => "Record<string, unknown>".into(),
            },
            _ => "unknown".into(),
        }
    };
    match o.get("type") {
        Some(Value::String(t)) => one(t),
        Some(Value::Array(ts)) => ts.iter().filter_map(|t| t.as_str()).map(one).collect::<Vec<_>>().join(" | "),
        _ => "unknown".into(),
    }
}

fn paren(t: String) -> String {
    if t.contains(" | ") { format!("({t})") } else { t }
}

fn camel(name: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in name.chars() {
        if c == '.' || c == '_' || c == '-' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// A typed TypeScript client for the operations the caller may use. Results are `unknown` because
/// the contract describes inputs only.
pub fn typescript(describe: &Value) -> String {
    let list = ops(describe);
    let mut s = String::new();
    s.push_str(&format!("// Generated from the `{}` profile, contract {}. Do not edit.\n\n", describe["profile"].as_str().unwrap_or(""), describe["contract"].as_str().unwrap_or("")));
    s.push_str("export interface Ops {\n");
    for o in &list {
        s.push_str(&format!("  /** {} */\n  {}: {};\n", o["doc"].as_str().unwrap_or("").replace("*/", "* /"), json!(o["name"]), ts_type(&object_schema(&o["input"]))));
    }
    s.push_str("}\n\nexport const commands = [");
    s.push_str(&list.iter().filter(|o| o["kind"] == "command").map(|o| o["name"].to_string()).collect::<Vec<_>>().join(", "));
    s.push_str("] as const;\n\n");
    s.push_str(
        r#"export class NuahError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

export class NuahClient {
  constructor(private base: string, private token?: string, private face = "client") {}

  async call<K extends keyof Ops>(op: K, input: Ops[K], idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Nuah-Face": this.face };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(`${this.base}/link/call/${String(op)}`, { method: "POST", headers, body: JSON.stringify(input) });
    const body = await res.json();
    if (!body.ok) throw new NuahError(body.error.code, body.error.message, body.error.details);
    return body.data;
  }
"#,
    );
    for o in &list {
        let name = o["name"].as_str().unwrap_or("");
        s.push_str(&format!("\n  /** {} */\n  {}(input: Ops[{}]) {{ return this.call({}, input); }}\n", o["doc"].as_str().unwrap_or("").replace("*/", "* /"), camel(name), json!(name), json!(name)));
    }
    s.push_str("}\n");
    s
}

// ---------- generic CLI ----------

/// Turn command-line words into an operation's input, using the operation's schema to decide
/// types. `key=value` is read as the property's type (a string stays a string, a number becomes
/// a number, `true` a boolean); `key:=<json>` always takes JSON; a lone `{...}` argument is the whole input.
pub fn input_from_args(schema: &Value, args: &[String]) -> Result<Value, String> {
    if let [one] = args {
        if one.trim_start().starts_with('{') {
            return serde_json::from_str(one).map_err(|e| format!("the JSON input is not valid: {e}"));
        }
    }
    let props = schema.get("properties").and_then(|p| p.as_object());
    let mut out = Map::new();
    for a in args {
        if let Some((k, raw)) = a.split_once(":=") {
            out.insert(k.to_string(), serde_json::from_str(raw).map_err(|e| format!("{k}: not valid JSON ({e})"))?);
            continue;
        }
        let Some((k, raw)) = a.split_once('=') else {
            return Err(format!("`{a}` is not key=value (use key:=<json> for non-text values)"));
        };
        let types: Vec<&str> = match props.and_then(|p| p.get(k)).and_then(|p| p.get("type")) {
            Some(Value::String(t)) => vec![t.as_str()],
            Some(Value::Array(a)) => a.iter().filter_map(|t| t.as_str()).collect(),
            _ => vec!["string"],
        };
        let v = if raw == "null" && types.contains(&"null") {
            Value::Null
        } else if types.contains(&"string") {
            Value::String(raw.to_string())
        } else if types.contains(&"integer") {
            json!(raw.parse::<i64>().map_err(|_| format!("{k}: `{raw}` is not a whole number"))?)
        } else if types.contains(&"number") {
            json!(raw.parse::<f64>().map_err(|_| format!("{k}: `{raw}` is not a number"))?)
        } else if types.contains(&"boolean") {
            match raw {
                "true" | "yes" | "1" => json!(true),
                "false" | "no" | "0" => json!(false),
                _ => return Err(format!("{k}: `{raw}` is not true or false")),
            }
        } else {
            serde_json::from_str(raw).map_err(|e| format!("{k}: expected JSON ({e}); write it as {k}:=<json>"))?
        };
        out.insert(k.to_string(), v);
    }
    Ok(Value::Object(out))
}

/// One line per property of an operation's input, for `help`.
pub fn describe_input(schema: &Value) -> Vec<String> {
    let required: Vec<&str> = schema.get("required").and_then(|r| r.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
    schema
        .get("properties")
        .and_then(|p| p.as_object())
        .map(|props| {
            props
                .iter()
                .map(|(k, v)| format!("{k}{}  {}", if required.contains(&k.as_str()) { " (required)" } else { "" }, ts_type(v)))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({"contract": "0.1", "profile": "t", "ops": [
            {"name": "tasks.create", "kind": "command", "permission": "tasks.write", "doc": "Add a task.", "plugin": "tasks", "allowed": true,
             "input": {"type": "object", "required": ["title"], "additionalProperties": false, "properties": {
                 "title": {"type": "string"}, "priority": {"type": "integer"}, "tags": {"type": "array", "items": {"type": "string"}},
                 "status": {"enum": ["a", "b"]}, "due": {"type": ["string", "null"]}}}},
            {"name": "tasks.list", "kind": "query", "permission": "tasks.read", "doc": "List.", "plugin": "tasks", "allowed": true, "input": {"type": "object"}},
            {"name": "admin.wipe", "kind": "command", "permission": "admin", "doc": "No.", "plugin": "admin", "allowed": false, "input": {}}]})
    }

    #[test]
    fn openapi_has_one_path_per_allowed_op_and_marks_idempotency() {
        let o = openapi(&sample());
        let paths = o["paths"].as_object().unwrap();
        assert!(paths.contains_key("/link/call/tasks.create") && paths.contains_key("/link/call/tasks.list") && !paths.contains_key("/link/call/admin.wipe"));
        let create = &paths["/link/call/tasks.create"]["post"];
        assert_eq!(create["x-permission"], "tasks.write");
        assert!(create["parameters"].as_array().unwrap().iter().any(|p| p["name"] == "Idempotency-Key"));
        let list = &paths["/link/call/tasks.list"]["post"];
        assert!(!list["parameters"].as_array().unwrap().iter().any(|p| p["name"] == "Idempotency-Key"));
    }

    #[test]
    fn typescript_types_follow_the_schema() {
        let ts = typescript(&sample());
        assert!(ts.contains(r#""title": string"#), "{ts}");
        assert!(ts.contains(r#""priority"?: number"#), "{ts}");
        assert!(ts.contains(r#""tags"?: string[]"#), "{ts}");
        assert!(ts.contains(r#""status"?: "a" | "b""#), "{ts}");
        assert!(ts.contains(r#""due"?: string | null"#), "{ts}");
        assert!(ts.contains("tasksCreate(input: Ops[\"tasks.create\"])"), "{ts}");
        assert!(!ts.contains("adminWipe"));
        assert!(ts.contains(r#"export const commands = ["tasks.create"] as const"#), "{ts}");
    }

    #[test]
    fn tools_use_underscored_names_and_flag_read_only() {
        let t = tool_definitions(&sample());
        assert_eq!(t[0]["name"], "tasks_create");
        assert_eq!(t[0]["op"], "tasks.create");
        assert_eq!(t[1]["annotations"]["readOnlyHint"], true);
        assert_eq!(t.as_array().unwrap().len(), 2);
    }

    #[test]
    fn cli_words_become_typed_input() {
        let schema = &sample()["ops"][0]["input"];
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let v = input_from_args(schema, &args(&["title=7", "priority=3", "tags:=[\"a\",\"b\"]", "due=null"])).unwrap();
        assert_eq!(v, json!({"title": "7", "priority": 3, "tags": ["a", "b"], "due": null}));
        assert!(input_from_args(schema, &args(&["priority=high"])).unwrap_err().contains("whole number"));
        assert!(input_from_args(schema, &args(&["oops"])).unwrap_err().contains("key=value"));
        assert_eq!(input_from_args(schema, &args(&[r#"{"title":"x"}"#])).unwrap(), json!({"title": "x"}));
        assert!(describe_input(schema).contains(&"title (required)  string".to_string()));
    }
}
