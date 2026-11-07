//! Madar's server: the Madar plugins, the `http` Projection with Madar's own routes (file downloads, link
//! previews), and the product description the host needs. Nothing here edits Nuah.

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use nuah_http::{blocking, credential, no_store, ApiError, Http};
use nuah_kernel::{CallRequest, Catalog, Category, Core, Error, Profile};
use serde_json::{json, Value};
use std::sync::Arc;

/// An uploaded file. Images show inline; everything else downloads. A file never runs as a page.
async fn file(State(core): State<Core>, Path(id): Path<String>, headers: HeaderMap) -> Result<Response, ApiError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let req = CallRequest { credential: credential(&headers), op: "files.download".into(), input: json!({"id": id}), key: None, contract: None };
    let out = blocking(move || core.call(req)).await??.output;
    let bytes = STANDARD.decode(out["data"].as_str().unwrap_or("")).map_err(|_| Error::internal("stored file is not valid base64"))?;
    let ty = out["type"].as_str().unwrap_or("application/octet-stream").to_string();
    let name: String = out["name"].as_str().unwrap_or("file").chars().filter(|c| c.is_ascii_alphanumeric() || " ._-".contains(*c)).collect();
    let inline = ty.starts_with("image/");
    let disposition = format!("{}; filename=\"{}\"", if inline { "inline" } else { "attachment" }, name);
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_str(&ty).unwrap_or(HeaderValue::from_static("application/octet-stream"))),
            (header::CONTENT_DISPOSITION, HeaderValue::from_str(&disposition).unwrap_or(HeaderValue::from_static("attachment"))),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=3600")),
            (header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("sandbox; default-src 'none'")),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Clone)]
struct Previews {
    core: Core,
    fetcher: Option<Arc<madar_core::previews::Fetcher>>,
}

/// A link preview: `previews.get` first (who may ask, is the plugin on), then the fetch, off the async threads
/// and outside any transaction (ADR 0026). 404 when the server was not set up to fetch.
async fn preview(State(app): State<Previews>, headers: HeaderMap, Json(body): Json<Value>) -> Result<Response, ApiError> {
    use madar_core::previews::Refusal;
    let Some(fetcher) = app.fetcher.clone() else {
        return Err(Error::reason(Category::NotFound, "previews.unavailable", "Link previews are not set up on this server").into());
    };
    let cred = credential(&headers);
    let core = app.core.clone();
    let url = body["url"].as_str().unwrap_or("").to_string();
    let (who, plain) = blocking(move || -> nuah_kernel::Result<(String, Value)> {
        let who = core.authenticate(cred.as_deref())?.subject;
        let plain = core.call(CallRequest { credential: cred, op: "previews.get".into(), input: json!({"url": url}), key: None, contract: None })?.output;
        Ok((who, plain))
    })
    .await??;
    let target = plain["url"].as_str().unwrap_or("").to_string();
    let got = blocking(move || fetcher.get(&who, &target)).await?;
    match got {
        Ok(v) => Ok(no_store(Json(json!({"ok": true, "output": v})))),
        Err(Refusal::RateLimited) => Err(Error::reason(Category::Denied, "previews.rate_limited", "Too many previews just now, try again in a minute").into()),
        Err(Refusal::Invalid) => Err(Error::invalid("url", "is not a public web address").into()),
        Err(_) => Err(Error::reason(Category::NotFound, "previews.unavailable", "No preview could be made for that address").into()),
    }
}

/// Madar's extra routes for the `http` Projection. `previews`: fetch link previews from public addresses (off unless asked for).
pub fn routes(previews: Option<Arc<madar_core::previews::Fetcher>>) -> impl Fn(Core) -> Router + Send + Sync + 'static {
    move |core| {
        Router::new()
            .route("/files/{id}", get(file).with_state(core.clone()))
            .route("/previews", post(preview).layer(axum::extract::DefaultBodyLimit::max(4 * 1024)).with_state(Previews { core, fetcher: previews.clone() }))
    }
}

/// Madar's plugins plus the `http` Projection with Madar's routes.
pub fn catalog(previews: bool) -> Catalog {
    let mut c = madar_core::catalog();
    let fetcher = previews.then(|| Arc::new(madar_core::previews::Fetcher::new(false, 20)));
    c.0.push(Arc::new(Http::new().with_routes(routes(fetcher))));
    c
}

/// Madar as the host sees it.
pub struct Madar;

impl nuah_host::Product for Madar {
    fn name(&self) -> &str {
        "madar"
    }
    fn catalog(&self, with: &[String]) -> Catalog {
        catalog(with.iter().any(|w| w == "previews"))
    }
    fn server_profile(&self, db: &str, accounts: Value) -> Profile {
        madar_core::profile_server(db, accounts)
    }
    fn starting_point(&self) -> Profile {
        madar_core::profile_embedded("madar.db")
    }
}
