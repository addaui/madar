//! The HTTP and SSE Projection of the Link ([Link spec]). It knows nothing about tasks: it exposes
//! whatever contract the Core describes. Sessions come from the `auth.*` Operations ([ADR 0010]);
//! a browser Face holds its session in an HttpOnly cookie, any other Face sends a bearer token.
//!
//!   GET  /healthz                   liveness, nothing else
//!   GET  /link/describe             public before sign-in, full after
//!   POST /link/call/{op}            run an Operation; the JSON body is the input
//!   GET  /pulse                     server-sent events; resume with ?after=<cursor> or Last-Event-ID
//!   GET  /link/openapi.json | tools.json | client.ts   generated from the contract (sign-in required)
//!
//! [Link spec]: https://docs.addaui.com/nuah/specs/link/
//! [ADR 0010]: https://docs.addaui.com/nuah/adr/0010-sign-in-is-an-operation-sessions-expire/

use axum::body::Bytes;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as Sse, KeepAlive};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{extract::Path, Json, Router};
use futures_util::Stream;
use nuah_kernel::{CallRequest, Category, Core, Error};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

pub const COOKIE: &str = "nuah_session";

#[derive(Clone, Debug)]
pub struct Config {
    /// Host names the server answers to; anything else gets 421 (DNS rebinding).
    pub hosts: Vec<String>,
    /// Add `Secure` to the session cookie (set when a TLS proxy fronts the server).
    pub secure_cookie: bool,
    /// Static Faces to host: (URL prefix such as `/faces/web`, directory).
    pub faces: Vec<(String, std::path::PathBuf)>,
}

impl Default for Config {
    fn default() -> Self {
        Config { hosts: ["localhost", "127.0.0.1", "[::1]"].iter().map(|s| s.to_string()).collect(), secure_cookie: false, faces: vec![] }
    }
}

#[derive(Clone)]
struct App {
    core: Core,
    cfg: Arc<Config>,
}

struct ApiError(Error);

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut err = self.0;
        let status = StatusCode::from_u16(err.category.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        // Internals (SQL messages, panics) stay in the server log; the caller gets a reference to quote.
        if err.category == Category::Internal {
            let reference = format!("{:08x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0));
            eprintln!("[nuah-server] error ref {reference}: {}", err.message);
            err = Error::internal(format!("Something went wrong on the server (ref {reference})"));
        }
        (status, [(header::CACHE_CONTROL, "no-store")], Json(json!({"ok": false, "error": err}))).into_response()
    }
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    header_str(headers, "authorization").and_then(|v| v.strip_prefix("Bearer ").map(|t| t.trim().to_string()))
}

fn cookie(headers: &HeaderMap) -> Option<String> {
    let all = header_str(headers, "cookie")?;
    all.split(';').filter_map(|p| p.trim().split_once('=')).find(|(k, _)| *k == COOKIE).map(|(_, v)| v.to_string())
}

/// A bearer token wins over the cookie, so a script on a machine with a browser session is not confused.
fn credential(headers: &HeaderMap) -> Option<String> {
    bearer(headers).or_else(|| cookie(headers))
}

/// Storage calls never run on the async worker threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f).await.map_err(|e| ApiError(Error::internal(format!("task failed: {e}"))))
}

fn no_store<T: IntoResponse>(t: T) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], t).into_response()
}

async fn describe(State(app): State<App>, headers: HeaderMap) -> Result<Response, ApiError> {
    let (core, cred) = (app.core.clone(), credential(&headers));
    let body = blocking(move || match core.authenticate(cred.as_deref()) {
        Ok(who) => core.describe(&who),
        Err(_) => core.describe_public(),
    })
    .await?;
    Ok(no_store(Json(body)))
}

/// The contract documents describe what the caller may do, so they need a signed-in caller.
async fn generated(app: App, headers: HeaderMap, make: fn(&Value) -> Response) -> Result<Response, ApiError> {
    let (core, cred) = (app.core.clone(), credential(&headers));
    let d = blocking(move || core.authenticate(cred.as_deref()).map(|who| core.describe(&who))).await??;
    Ok(make(&d))
}
async fn openapi_doc(State(app): State<App>, headers: HeaderMap) -> Result<Response, ApiError> {
    generated(app, headers, |d| no_store(Json(nuah_kernel::contract::openapi(d)))).await
}
async fn tools_doc(State(app): State<App>, headers: HeaderMap) -> Result<Response, ApiError> {
    generated(app, headers, |d| no_store(Json(nuah_kernel::contract::tool_definitions(d)))).await
}
async fn client_ts(State(app): State<App>, headers: HeaderMap) -> Result<Response, ApiError> {
    generated(app, headers, |d| {
        ([(header::CONTENT_TYPE, "text/typescript; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], nuah_kernel::contract::typescript(d)).into_response()
    })
    .await
}

fn session_cookie(app: &App, token: &str, expires_at: i64) -> HeaderValue {
    let secs = ((expires_at - app.core.now()) / 1000).max(0);
    let secure = if app.cfg.secure_cookie { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={secs}{secure}")).unwrap()
}

fn clearing_cookie(app: &App) -> HeaderValue {
    let secure = if app.cfg.secure_cookie { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure}")).unwrap()
}

async fn call(State(app): State<App>, Path(op): Path<String>, headers: HeaderMap, body: Bytes) -> Result<Response, ApiError> {
    let mut input: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|e| Error::invalid("body", &format!("is not valid JSON: {e}")))?
    };
    let cookie_mode = header_str(&headers, "x-nuah-session").as_deref() == Some("cookie");
    let held = cookie(&headers);
    // A browser Face never sees its session token, so it cannot name it: the server fills it in.
    if matches!(op.as_str(), "auth.refresh" | "auth.sign_out") {
        if let (Some(obj), Some(t)) = (input.as_object_mut(), held.as_ref()) {
            obj.entry("token").or_insert_with(|| json!(t));
        }
    }
    let req = CallRequest { credential: credential(&headers), op: op.clone(), input, key: header_str(&headers, "idempotency-key"), contract: header_str(&headers, "x-nuah-contract") };
    let core = app.core.clone();
    let mut res = blocking(move || core.call(req)).await??;
    let mut cookie_header = None;
    match op.as_str() {
        "auth.sign_in" if cookie_mode => {
            if let (Some(t), Some(exp)) = (res.output["token"].as_str().map(String::from), res.output["expires_at"].as_i64()) {
                cookie_header = Some(session_cookie(&app, &t, exp));
                res.output.as_object_mut().map(|o| o.remove("token"));
            }
        }
        "auth.refresh" if held.is_some() && bearer(&headers).is_none() => {
            if let (Some(t), Some(exp)) = (held, res.output["expires_at"].as_i64()) {
                cookie_header = Some(session_cookie(&app, &t, exp));
            }
        }
        "auth.sign_out" if held.is_some() => cookie_header = Some(clearing_cookie(&app)),
        _ => {}
    }
    let mut out = no_store(Json(json!({"ok": true, "output": res.output, "replayed": res.replayed})));
    if let Some(c) = cookie_header {
        out.headers_mut().append(header::SET_COOKIE, c);
    }
    Ok(out)
}

const BATCH: usize = 200;

async fn pulse(
    State(app): State<App>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::sse::Sse<impl Stream<Item = Result<Sse, Infallible>>>, ApiError> {
    let cred = credential(&headers);
    let core = app.core.clone();
    let c = cred.clone();
    let who = blocking({
        let core = core.clone();
        move || core.authenticate(c.as_deref())
    })
    .await??;
    // EventSource resends the last id it saw as Last-Event-ID when it reconnects but keeps the
    // original URL, so the header can be newer than ?after. Cursors are opaque and only ever grow
    // with the log, so the one that was delivered last is the header.
    let after = header_str(&headers, "last-event-id").or_else(|| q.get("after").cloned());
    let start = match after {
        Some(a) => a,
        None => blocking({
            let core = core.clone();
            move || core.pulse_now()
        })
        .await??,
    };
    let mut wake = core.subscribe();
    let who0 = who.subject.clone();
    let stream = async_stream::stream! {
        let mut cursor = start.clone();
        yield Ok(Sse::default().event("ready").data(json!({"cursor": cursor, "subject": who0}).to_string()));
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            loop {
                let (c, cr, from) = (core.clone(), cred.clone(), cursor.clone());
                // The session is checked again on every round: a stream ends when its session does.
                let r = tokio::task::spawn_blocking(move || {
                    let who = c.authenticate(cr.as_deref())?;
                    c.pulse(&who, Some(&from), BATCH)
                })
                .await;
                let batch = match r {
                    Ok(Ok(b)) => b,
                    Ok(Err(e)) => {
                        yield Ok(Sse::default().event("closed").data(json!({"category": e.category, "key": e.key}).to_string()));
                        return;
                    }
                    Err(_) => return,
                };
                if batch.reset {
                    cursor = batch.cursor.clone();
                    yield Ok(Sse::default().event("reset").data(json!({"cursor": cursor}).to_string()));
                    break;
                }
                for e in &batch.events {
                    yield Ok(Sse::default().id(e.cursor.clone()).event(e.kind.clone()).data(serde_json::to_string(e).unwrap_or_default()));
                }
                cursor = batch.cursor;
                if !batch.more { break; }
            }
            // A commit wakes the stream at once; the tick covers another process writing the same database.
            tokio::select! {
                r = wake.changed() => if r.is_err() { return },
                _ = tick.tick() => {}
            }
        }
    };
    Ok(axum::response::sse::Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

/// Liveness only: it says nothing about the data.
async fn health() -> Json<Value> {
    Json(json!({"ok": true}))
}

fn host_only(h: &str) -> String {
    match h.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => host.to_lowercase(),
        _ => h.to_lowercase(),
    }
}

fn refuse(status: StatusCode, category: &str, key: &str, message: &str) -> Response {
    (status, Json(json!({"ok": false, "error": {"category": category, "key": key, "message": message}}))).into_response()
}

/// Browser-facing protections: Host allow-list (DNS rebinding), Origin must match Host (cross-site
/// writes), commands must be JSON with the Face header (a plain cross-site form cannot send both),
/// and security headers on every response.
async fn guard(State(cfg): State<Arc<Config>>, req: Request, next: Next) -> Response {
    let host_header = header_str(req.headers(), "host").unwrap_or_default();
    if !cfg.hosts.iter().any(|h| *h == host_only(&host_header)) {
        return refuse(StatusCode::MISDIRECTED_REQUEST, "invalid", "server.bad_host", "This host name is not allowed. Start the server with --allow-host to add it.");
    }
    if let Some(origin) = header_str(req.headers(), "origin") {
        if origin.split("://").nth(1).unwrap_or(&origin) != host_header {
            return refuse(StatusCode::FORBIDDEN, "denied", "server.bad_origin", "Cross-origin requests are not allowed.");
        }
    }
    if req.method() == Method::POST && req.uri().path().starts_with("/link/call/") {
        if !header_str(req.headers(), "content-type").is_some_and(|c| c.starts_with("application/json")) {
            return refuse(StatusCode::UNSUPPORTED_MEDIA_TYPE, "invalid", "server.not_json", "Send the input as application/json.");
        }
        if req.headers().get("x-nuah-face").is_none() {
            return refuse(StatusCode::BAD_REQUEST, "invalid", "server.no_face", "The X-Nuah-Face header is required.");
        }
    }
    let is_face = req.uri().path().starts_with("/faces/");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    if is_face {
        // Faces are small and change with every release: always ask the server whether they changed.
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    res
}

pub fn router(core: Core, cfg: Config) -> Router {
    let cfg = Arc::new(cfg);
    let mut r = Router::new()
        .route("/healthz", get(health))
        .route("/link/describe", get(describe))
        .route("/link/call/{op}", post(call))
        .route("/link/openapi.json", get(openapi_doc))
        .route("/link/tools.json", get(tools_doc))
        .route("/link/client.ts", get(client_ts))
        .route("/pulse", get(pulse))
        .with_state(App { core, cfg: cfg.clone() });
    for (prefix, dir) in &cfg.faces {
        r = r.nest_service(prefix, tower_http::services::ServeDir::new(dir));
    }
    if let Some((prefix, _)) = cfg.faces.first() {
        let to = format!("{prefix}/");
        r = r.route("/", get(move || async move { axum::response::Redirect::temporary(&to) }));
    }
    r.layer(middleware::from_fn_with_state(cfg, guard))
}

/// Keep the Core's housekeeping going: run Listeners after commits, trim the change log. Needs a
/// tokio runtime; abort the handle to stop it.
pub fn spawn_background(core: Core) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut wake = core.subscribe();
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut rounds = 0u64;
        loop {
            let c = core.clone();
            rounds += 1;
            let _ = tokio::task::spawn_blocking(move || {
                if let Err(e) = c.drain_listeners() {
                    eprintln!("[nuah-server] listener failed: {}", e.message);
                }
                if rounds % 600 == 0 {
                    let _ = c.prune_log(nuah_kernel::pipeline::CHANGE_RETENTION);
                }
            })
            .await;
            tokio::select! {
                r = wake.changed() => if r.is_err() { return },
                _ = tick.tick() => {}
            }
        }
    })
}
