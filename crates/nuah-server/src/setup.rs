//! Setup mode: a small server for choosing plugins and settings BEFORE a core can start.
//! It never starts a core and never touches data. It reads the catalog, checks a draft profile with
//! the same resolver the kernel uses, and writes the profile file only when the draft resolves.
//! Local use only: the binary refuses to run it on a non-loopback address.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use nuah_kernel::setup::{catalog_info, distribution_from_json, profile_json};
use nuah_kernel::{Core, Distribution, Plugin};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::ServeDir;

#[derive(Clone)]
pub struct Setup {
    pub catalog: Vec<Arc<dyn Plugin>>,
    /// Where the profile is read from and saved to.
    pub path: PathBuf,
    /// The draft shown first when the file does not exist yet.
    pub starting_point: Distribution,
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn current(s: &Setup) -> Result<(Distribution, bool), String> {
    match std::fs::read_to_string(&s.path) {
        Ok(text) => {
            let v: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", s.path.display()))?;
            Ok((distribution_from_json(s.catalog.clone(), &v)?, true))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((s.starting_point.clone(), false)),
        Err(e) => Err(format!("cannot read {}: {e}", s.path.display())),
    }
}

async fn state(State(s): State<Setup>) -> Response {
    let r = tokio::task::spawn_blocking(move || {
        let (dist, exists) = current(&s)?;
        let mut info = catalog_info(&dist);
        info["path"] = json!(s.path.display().to_string());
        info["file_exists"] = json!(exists);
        info["problems"] = json!(Core::check(&dist));
        Ok::<Value, String>(info)
    })
    .await;
    match r {
        Ok(Ok(info)) => reply(StatusCode::OK, info),
        Ok(Err(m)) => reply(StatusCode::UNPROCESSABLE_ENTITY, json!({"ok": false, "error": {"code": "invalid_profile", "message": m}})),
        Err(_) => reply(StatusCode::INTERNAL_SERVER_ERROR, json!({"ok": false, "error": {"code": "internal", "message": "setup failed"}})),
    }
}

async fn check(State(s): State<Setup>, Json(draft): Json<Value>) -> Response {
    match distribution_from_json(s.catalog.clone(), &draft) {
        Err(m) => reply(StatusCode::UNPROCESSABLE_ENTITY, json!({"ok": false, "error": {"code": "invalid_profile", "message": m}})),
        Ok(dist) => {
            let problems = tokio::task::spawn_blocking(move || Core::check(&dist)).await.unwrap_or_default();
            reply(StatusCode::OK, json!({"ok": problems.is_empty(), "problems": problems}))
        }
    }
}

async fn save(State(s): State<Setup>, Json(draft): Json<Value>) -> Response {
    let dist = match distribution_from_json(s.catalog.clone(), &draft) {
        Ok(d) => d,
        Err(m) => return reply(StatusCode::UNPROCESSABLE_ENTITY, json!({"ok": false, "error": {"code": "invalid_profile", "message": m}})),
    };
    let r = tokio::task::spawn_blocking(move || {
        let problems = Core::check(&dist);
        if !problems.is_empty() {
            return Err(problems);
        }
        // Write beside the target and rename, so a crash never leaves half a profile.
        let tmp = s.path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&profile_json(&dist)).unwrap_or_default() + "\n";
        std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &s.path)).map_err(|e| {
            vec![nuah_kernel::setup::Problem { code: "write_failed".into(), plugins: vec![], message: format!("cannot write {}: {e}", s.path.display()) }]
        })?;
        Ok(s.path.display().to_string())
    })
    .await;
    match r {
        Ok(Ok(path)) => reply(StatusCode::OK, json!({"ok": true, "saved": path})),
        Ok(Err(problems)) => reply(StatusCode::UNPROCESSABLE_ENTITY, json!({"ok": false, "problems": problems})),
        Err(_) => reply(StatusCode::INTERNAL_SERVER_ERROR, json!({"ok": false, "error": {"code": "internal", "message": "setup failed"}})),
    }
}

pub fn setup_router(setup: Setup, face_dir: Option<PathBuf>, hosts: Vec<String>) -> Router {
    let mut r = Router::new()
        .route("/setup/state", get(state))
        .route("/setup/check", post(check))
        .route("/setup/save", post(save))
        .with_state(setup);
    if let Some(dir) = face_dir {
        r = r.route("/", get(|| async { Redirect::temporary("/faces/setup/") })).nest_service("/faces/setup", ServeDir::new(dir));
    }
    crate::protect(r, hosts)
}
