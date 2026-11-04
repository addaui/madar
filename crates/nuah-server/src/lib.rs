//! The HTTP projection of the Link, plus Pulse over server-sent events and static hosting for faces.
//! This crate knows nothing about tasks: it exposes whatever contract the core describes.
//!
//!   GET  /link/describe          self-description (optional Authorization)
//!   POST /link/call/{op}         run an operation; JSON body is the input
//!   GET  /pulse?after=N          server-sent events, replayed from N then live; Last-Event-ID also works
//!   ANY  /x/...                  routes that plugins added
//!   GET  /faces/web/...          static web face

use axum::body::Bytes;
use axum::extract::{Path, Query, Request, State};
use axum::middleware::{self, Next};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::sse::{Event as Sse, KeepAlive};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use futures_util::Stream;
use nuah_kernel::{CallRequest, Core, LinkError};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct App {
    core: Core,
}

struct ApiError(LinkError);

impl From<LinkError> for ApiError {
    fn from(e: LinkError) -> Self {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.0.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut err = self.0;
        // Internals (SQL messages, panics) stay in the server log; the caller gets a reference to quote.
        if status.is_server_error() && err.code != "capability_denied" {
            let reference = format!("{:08x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0));
            eprintln!("[nuah-server] error ref {reference}: {err}");
            err = LinkError::new("internal", format!("Something went wrong on the server (ref {reference})"));
        }
        (status, [(header::CACHE_CONTROL, "no-store")], Json(json!({"ok": false, "error": err}))).into_response()
    }
}

fn bearer(headers: &HeaderMap, query: Option<&String>) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim().to_string())
        // Browsers cannot set headers on EventSource, so Pulse also accepts ?token=.
        .or_else(|| query.cloned())
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f).await.map_err(|e| ApiError(LinkError::internal(format!("task failed: {e}"))))
}

async fn describe(State(app): State<App>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let token = bearer(&headers, None);
    let face = q.get("face").cloned();
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(app.core.describe(token.as_deref(), face.as_deref())),
    )
        .into_response()
}

async fn call(State(app): State<App>, Path(op): Path<String>, headers: HeaderMap, body: Bytes) -> Result<Response, ApiError> {
    let input: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|e| LinkError::new("invalid_input", format!("body is not valid JSON: {e}")))?
    };
    let req = CallRequest {
        credential: bearer(&headers, None),
        op,
        input,
        idempotency_key: header_str(&headers, "idempotency-key"),
        face: header_str(&headers, "x-nuah-face"),
    };
    let core = app.core.clone();
    let res = blocking(move || core.call(req)).await??;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(json!({"ok": true, "data": res.data, "replayed": res.replayed}))).into_response())
}

async fn plugin_route(
    State(app): State<App>,
    method: Method,
    Path(rest): Path<String>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let token = bearer(&headers, None);
    let core = app.core.clone();
    let path = format!("/x/{rest}");
    let res = blocking(move || core.route(method.as_str(), &path, token.as_deref(), q, body.to_vec())).await??;
    let mut out = Response::new(axum::body::Body::from(res.body));
    *out.status_mut() = StatusCode::from_u16(res.status).unwrap_or(StatusCode::OK);
    out.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(&res.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    out.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for (k, v) in res.headers {
        if let (Ok(k), Ok(v)) = (HeaderName::try_from(k), HeaderValue::from_str(&v)) {
            out.headers_mut().insert(k, v);
        }
    }
    Ok(out)
}

async fn pulse(
    State(app): State<App>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::sse::Sse<impl Stream<Item = Result<Sse, Infallible>>>, ApiError> {
    let who = app.core.authenticate(bearer(&headers, q.get("token")).as_deref())?;
    // EventSource resends the last id it saw as Last-Event-ID when it reconnects, but keeps the
    // original URL, so the header can be newer than ?after. Take whichever is further along.
    let from_query: Option<u64> = q.get("after").and_then(|a| a.parse().ok());
    let from_header: Option<u64> = header_str(&headers, "last-event-id").and_then(|a| a.parse().ok());
    let after: u64 = match (from_query, from_header) {
        (None, None) => app.core.latest_seq_for(&who.subject), // live only
        (a, b) => a.unwrap_or(0).max(b.unwrap_or(0)),
    };
    let core = app.core.clone();
    let mut wake = core.subscribe();
    // The stream is "read the log in order". A wake-up (some commit happened) or a one-second tick
    // (another process may have written to the same database) prompts the next read. Because every
    // read starts from the last delivered number, events cannot be skipped or reordered.
    let stream = async_stream::stream! {
        let mut last = after;
        yield Ok(Sse::default().event("ready").data(json!({"after": after, "latest_seq": core.latest_seq_for(&who.subject)}).to_string()));
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            loop {
                let c = core.clone();
                let subject = who.subject.clone();
                let from = last;
                // A storage error ends the stream; the browser reconnects with Last-Event-ID.
                let Ok(Ok(batch)) = tokio::task::spawn_blocking(move || c.events_since(&subject, from, 500)).await else { return };
                let full = batch.len() == 500;
                for e in batch {
                    last = e.seq;
                    yield Ok(Sse::default().id(e.seq.to_string()).event(e.kind.clone()).data(json!(e).to_string()));
                }
                if !full { break; }
            }
            tokio::select! {
                r = wake.recv() => {
                    if let Err(tokio::sync::broadcast::error::RecvError::Closed) = r { return }
                }
                _ = tick.tick() => {}
            }
        }
    };
    Ok(axum::response::sse::Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

async fn health(State(app): State<App>) -> Json<Value> {
    Json(json!({"ok": true, "latest_seq": app.core.latest_seq()}))
}

/// Hosts the server answers to. Anything else (DNS rebinding) gets 421.
pub fn default_hosts() -> Vec<String> {
    ["localhost", "127.0.0.1", "[::1]"].iter().map(|s| s.to_string()).collect()
}

fn host_only(h: &str) -> String {
    match h.rsplit_once(':') {
        Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) && !port.is_empty() => host.to_lowercase(),
        _ => h.to_lowercase(),
    }
}

fn refuse(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({"ok": false, "error": {"code": code, "message": message}}))).into_response()
}

/// Browser-facing protections, applied to every response and request:
/// - Host allow-list (blocks DNS rebinding),
/// - Origin must match Host when present (blocks cross-site writes),
/// - commands must be JSON with the face header, which a plain cross-site form cannot send,
/// - security headers that plugin routes cannot override.
async fn guard(State(hosts): State<Arc<Vec<String>>>, req: Request, next: Next) -> Response {
    let host_header = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !hosts.iter().any(|h| *h == host_only(&host_header)) {
        return refuse(StatusCode::MISDIRECTED_REQUEST, "bad_host", "This host name is not allowed. Start the server with --allow-host to add it.");
    }
    if let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let origin_host = origin.split("://").nth(1).unwrap_or(origin);
        if origin_host != host_header {
            return refuse(StatusCode::FORBIDDEN, "bad_origin", "Cross-origin requests are not allowed.");
        }
    }
    if req.method() == Method::POST && req.uri().path().starts_with("/link/call/") {
        let json_body = req.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|c| c.starts_with("application/json"));
        if !json_body {
            return refuse(StatusCode::UNSUPPORTED_MEDIA_TYPE, "invalid_input", "Send the input as application/json.");
        }
        if req.headers().get("x-nuah-face").is_none() {
            return refuse(StatusCode::BAD_REQUEST, "invalid_input", "The X-Nuah-Face header is required.");
        }
    }
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    res
}

pub fn router(core: Core, web_dir: Option<PathBuf>) -> Router {
    router_with_hosts(core, web_dir, default_hosts())
}

pub fn router_with_hosts(core: Core, web_dir: Option<PathBuf>, hosts: Vec<String>) -> Router {
    let mut r = Router::new()
        .route("/healthz", get(health))
        .route("/link/describe", get(describe))
        .route("/link/call/{op}", post(call))
        .route("/pulse", get(pulse))
        .route("/x/{*rest}", any(plugin_route));
    if let Some(dir) = web_dir {
        r = r
            .route("/", get(|| async { Redirect::temporary("/faces/web/") }))
            .nest_service("/faces/web", ServeDir::new(dir));
    }
    r.layer(middleware::from_fn_with_state(Arc::new(hosts), guard)).with_state(App { core })
}
