// SPDX-License-Identifier: Apache-2.0
//! The product description the shell needs, the `http` Projection with Madar's own route (file downloads) and the
//! plugin that publishes the web Face. Nothing here edits Nuah.

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use nuah_http::{blocking, credential, ApiError, Http};
use nuah_kernel::{CallRequest, Catalog, Core, Error, Manifest, Plugin, Profile};
use serde_json::json;
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

/// Madar's extra routes for the `http` Projection: file downloads. Everything else is an Operation.
pub fn routes() -> impl Fn(Core) -> Router + Send + Sync + 'static {
    move |core| Router::new().route("/files/{id}", get(file).with_state(core))
}

/// The plugin that publishes the web Face (`./faces/madar/web`, under the faces directory).
pub struct Web;

impl Plugin for Web {
    fn manifest(&self) -> Manifest {
        serde_json::from_value(json!({
            "id": "@madar/web", "version": "0.3.0", "name": "Web", "runtime": "data",
            "description": "Madar's web app, published as the Face `web`, shown at /",
            "requires": {"plugins": ["@nuah/http"]},
            "face": "web"
        }))
        .unwrap()
    }
}

/// Madar's plugins, the `http` Projection with Madar's routes, and the plugins that publish Faces.
pub fn full_catalog() -> Catalog {
    let mut c = crate::catalog();
    c.0.push(Arc::new(Http::new().with_routes(routes())));
    c.0.push(Arc::new(Web));
    c.0.push(Arc::new(nuah_console::Console));
    c
}

/// Madar as the shell sees it.
pub struct Madar;

impl nuah_shell::Product for Madar {
    fn name(&self) -> &str {
        "madar"
    }
    fn catalog(&self) -> Catalog {
        full_catalog()
    }
    /// What setup starts from: Madar on SQLite in the home directory, with the web app and the console. No
    /// accounts: the first administrator is asked for during setup.
    fn starting_point(&self, home: &std::path::Path) -> Profile {
        let db = home.join("madar.db");
        let mut p = crate::profile_server(&db.to_string_lossy(), json!([]));
        p.enabled.extend(["@nuah/http", "@madar/web", "@nuah/console"].map(String::from));
        p.grants.insert("@nuah/http".into(), vec!["serve".into()]);
        // the console changes the identity file (administrators only) and asks the shell to restart
        p.grants.insert("@nuah/console".into(), vec!["shell".into()]);
        p
    }
    fn bootstrap(&self) -> Option<Box<dyn nuah_shell::Bootstrap>> {
        Some(Box::new(nuah_setup_web::SetupWeb::new()))
    }
}
