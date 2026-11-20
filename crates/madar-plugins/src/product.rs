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

/// A file of a shared page (ADR 0084): `/share-files/<share>/<file>`, with `?pin=` for a share that has one. The share must use the file. Tried without
/// a credential first; a share for people who are signed in is tried again with the person's own.
async fn shared_file(State(core): State<Core>, Path((share, file)): Path<(String, String)>, axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>, headers: HeaderMap) -> Result<Response, ApiError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut input = json!({"id": share, "file": file});
    if let Some(pin) = q.get("pin") {
        input["pin"] = json!(pin);
    }
    let first = CallRequest { credential: None, op: "shares.file".into(), input: input.clone(), key: None, contract: None };
    let (c1, i1) = (core.clone(), first);
    let out = match blocking(move || c1.call(i1)).await? {
        Ok(r) => r.output,
        Err(e) if e.reason.as_deref() == Some("shares.sign_in") || e.reason.as_deref() == Some("shares.not_for_you") => {
            let again = CallRequest { credential: credential(&headers), op: "shares.file_signed".into(), input, key: None, contract: None };
            blocking(move || core.call(again)).await??.output
        }
        Err(e) => return Err(e.into()),
    };
    let bytes = STANDARD.decode(out["data"].as_str().unwrap_or("")).map_err(|_| Error::internal("stored file is not valid base64"))?;
    let ty = out["type"].as_str().unwrap_or("application/octet-stream").to_string();
    let inline = ty.starts_with("image/");
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_str(&ty).unwrap_or(HeaderValue::from_static("application/octet-stream"))),
            (header::CONTENT_DISPOSITION, HeaderValue::from_static(if inline { "inline" } else { "attachment" })),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=60")),
            (header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("sandbox; default-src 'none'")),
        ],
        bytes,
    )
        .into_response())
}

/// Madar's extra routes for the `http` Projection: file downloads and the files of shared pages. Everything else is an Operation.
pub fn routes() -> impl Fn(Core) -> Router + Send + Sync + 'static {
    move |core| Router::new().route("/files/{id}", get(file).with_state(core.clone())).route("/share-files/{share}/{file}", get(shared_file).with_state(core))
}

/// The plugin that publishes Madar's web app, the React Face (`./faces/madar/web-react`), built from `web/` (ADR 0058). It is shown at `/`
/// and opens shared pages at `/share`. The first, vanilla Face was retired; it is kept at the tag `web-frozen-vanilla`.
pub struct WebReact;

impl Plugin for WebReact {
    fn manifest(&self) -> Manifest {
        serde_json::from_value(json!({
            "id": "@madar/web-react", "version": "0.1.0", "name": "Web (React)", "runtime": "data",
            "description": "Madar's web app rebuilt on React 19, published as the Face `web-react`, shown at /faces/web-react/",
            "namespaces": ["face"],
            "requires": {"plugins": ["@nuah/http"], "extension_points": ["face.editor@^1"]},
            // the page's editor: whichever plugin provides it, never named here (ADR 0095)
            "defines": {"extension_points": {"face.editor": {"policy": "single", "browser": true, "version": "1.0.0", "input": {"type": "object"},
                "description": "The editor this Face mounts: a Browser module whose default export is {version, mount(place, hooks)}"}}},
            "face": "web-react"
        }))
        .unwrap()
    }
}

/// Madar's plugins, the `http` Projection with Madar's routes, and the plugins that publish Faces.
pub fn full_catalog() -> Catalog {
    let mut c = crate::catalog();
    c.0.push(Arc::new(Http::new().with_routes(routes())));
    c.0.push(Arc::new(WebReact));
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
        p.enabled.extend(["@nuah/http", "@madar/web-react", "@nuah/console", "@madar/features"].map(String::from));
        p.grants.insert("@nuah/http".into(), vec!["serve".into()]);
        // the app is the React Face, at `/`; `/share/<id>` opens the same Face in its reader (ADR 0084)
        let http = p.settings.entry("@nuah/http".into()).or_insert_with(|| json!({}));
        http["root"] = json!("web-react");
        http["face_paths"] = json!({"/share": "web-react"});
        // the console changes the identity file (administrators only) and asks the shell to restart
        p.grants.insert("@nuah/console".into(), vec!["shell".into()]);
        // the Owner switches feature plugins from the app's settings (ADR 0080); the plugin refuses every platform plugin itself
        p.grants.insert("@madar/features".into(), vec!["shell".into()]);
        p
    }
    fn bootstrap(&self) -> Option<Box<dyn nuah_shell::Bootstrap>> {
        Some(Box::new(nuah_setup_web::SetupWeb::new()))
    }
}
