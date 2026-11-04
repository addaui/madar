//! The HTTP projection of the Link, plus Pulse over server-sent events and static hosting for faces.
//! This crate knows nothing about tasks: it exposes whatever contract the core describes.
//!
//!   GET  /link/describe          self-description (optional Authorization)
//!   POST /link/call/{op}         run an operation; JSON body is the input
//!   GET  /pulse?after=N          server-sent events, replayed from N then live; Last-Event-ID also works
//!   ANY  /x/...                  routes that plugins added
//!   GET  /faces/web/...          static web face

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
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
        (status, [(header::CACHE_CONTROL, "no-store")], Json(json!({"ok": false, "error": self.0}))).into_response()
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
    let token = bearer(&headers, q.get("token"));
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
    // An explicit ?after wins, then Last-Event-ID (set by EventSource on reconnect), else live only.
    let after: u64 = q
        .get("after")
        .and_then(|a| a.parse().ok())
        .or_else(|| header_str(&headers, "last-event-id").and_then(|a| a.parse().ok()))
        .unwrap_or_else(|| app.core.latest_seq());
    let core = app.core.clone();
    let mut rx = core.subscribe(); // before the replay, so nothing falls in the gap
    let stream = async_stream::stream! {
        let mut last = after;
        yield Ok(Sse::default().event("ready").data(json!({"after": after, "latest_seq": core.latest_seq()}).to_string()));
        loop {
            let c = core.clone();
            let subject = who.subject.clone();
            let from = last;
            let batch = tokio::task::spawn_blocking(move || c.events_since(&subject, from, 500)).await;
            let Ok(Ok(batch)) = batch else { break };
            let full = batch.len() == 500;
            for e in batch {
                last = e.seq;
                yield Ok(Sse::default().id(e.seq.to_string()).event(e.kind.clone()).data(json!(e).to_string()));
            }
            if !full { break; }
        }
        loop {
            match rx.recv().await {
                Ok(e) if e.audience == who.subject && e.seq > last => {
                    last = e.seq;
                    yield Ok(Sse::default().id(e.seq.to_string()).event(e.kind.clone()).data(json!(e).to_string()));
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // fell behind: catch up from the log
                    let c = core.clone();
                    let subject = who.subject.clone();
                    let from = last;
                    if let Ok(Ok(batch)) = tokio::task::spawn_blocking(move || c.events_since(&subject, from, 5000)).await {
                        for e in batch {
                            last = e.seq;
                            yield Ok(Sse::default().id(e.seq.to_string()).event(e.kind.clone()).data(json!(e).to_string()));
                        }
                    }
                }
                Err(_) => break,
            }
        }
    };
    Ok(axum::response::sse::Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

async fn health(State(app): State<App>) -> Json<Value> {
    Json(json!({"ok": true, "latest_seq": app.core.latest_seq()}))
}

pub fn router(core: Core, web_dir: Option<PathBuf>) -> Router {
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
    r.with_state(App { core })
}
