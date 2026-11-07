//! Madar v2: a task manager built as plugins on the Nu'ah kernel.
//! Design: <https://docs.addaui.com/nuah/specs/madar-v2/>

#![recursion_limit = "512"]
pub mod content;
pub mod discussion;
pub mod pages;
pub mod projects;
pub mod small;
pub mod tasks;
pub mod files;
pub mod previews;
pub mod search;
pub mod timeline;
pub mod workspaces;
pub mod util;

use nuah_adapters::*;
use nuah_kernel::*;
use serde_json::json;
use std::sync::Arc;

/// Every plugin Madar ships, plus the adapters it can run on.
pub fn catalog() -> Catalog {
    let mut list: Vec<Arc<dyn Plugin>> = vec![
        Arc::new(AdapterMemory), Arc::new(AdapterSqlite), Arc::new(AuthLocal), Arc::new(AuthPassword),
        Arc::new(PolicyAllowAll), Arc::new(PolicyRoles), Arc::new(StdClock), Arc::new(StdIds),
        Arc::new(projects::Projects), Arc::new(tasks::Tasks), Arc::new(discussion::Discussion),
        Arc::new(small::Audit), Arc::new(small::Quota), Arc::new(small::Prefs), Arc::new(small::Export),
        Arc::new(small::Notify), Arc::new(small::NotifyInbox),
        Arc::new(content::Editor), Arc::new(content::EditorBasic), Arc::new(content::Refs), Arc::new(pages::Pages), Arc::new(timeline::Timeline), Arc::new(search::Search), Arc::new(files::Files), Arc::new(files::FilesDb), Arc::new(previews::Previews), Arc::new(workspaces::Workspaces),
    ];
    for t in small::themes() {
        list.push(Arc::new(t));
    }
    Catalog(list)
}

const FEATURES: [&str; 20] = ["projects", "tasks", "discussion", "audit", "quota", "prefs", "export", "notify", "notify-inbox", "theme-paper", "editor", "editor-basic", "refs", "pages", "timeline", "workspaces", "search", "files", "files-db", "previews"];

fn base_profile(name: &str, adapters: &[&str]) -> Profile {
    let mut enabled: Vec<String> = adapters.iter().map(|s| s.to_string()).collect();
    enabled.extend(FEATURES.iter().map(|s| s.to_string()));
    enabled.push("theme-ink".into());
    let mut p = Profile { name: name.into(), enabled, ..Default::default() };
    p.grants.insert("projects".into(), vec!["emit".into()]);
    p.grants.insert("tasks".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("discussion".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("prefs".into(), vec!["emit".into()]);
    p.grants.insert("pages".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("search".into(), vec!["call".into()]);
    p.grants.insert("files".into(), vec!["call".into()]);
    p.grants.insert("timeline".into(), vec!["call".into()]);
    p.grants.insert("workspaces".into(), vec!["emit".into()]);
    p.grants.insert("export".into(), vec!["call".into()]);
    p.grants.insert("notify-inbox".into(), vec!["emit".into()]);
    p
}

/// One person, one file, always signed in. For a Core only that person can reach.
pub fn profile_embedded(db_path: &str) -> Profile {
    let mut p = base_profile("embedded", &["db-sqlite", "auth-local", "policy-roles", "clock-system", "ids-random"]);
    p.settings.insert("db-sqlite".into(), json!({"path": db_path}));
    p
}

/// Several people with passwords. `accounts` are `{name, password_hash, roles}`.
pub fn profile_server(db_path: &str, accounts: serde_json::Value) -> Profile {
    let mut p = base_profile("server", &["db-sqlite", "auth-password", "policy-roles", "clock-system", "ids-random"]);
    p.settings.insert("db-sqlite".into(), json!({"path": db_path}));
    p.settings.insert("auth-password".into(), json!({"accounts": accounts}));
    p.settings.insert("quota".into(), json!({"max_tasks": 5000}));
    p.enabled.push("quota".into());
    p
}

/// In memory with predictable ids and a clock the test controls.
pub fn profile_test(extra_settings: &[(&str, serde_json::Value)]) -> Profile {
    let mut p = base_profile("test", &["db-memory", "auth-local", "policy-roles", "clock-fixed", "ids-sequential"]);
    for (k, v) in extra_settings {
        p.settings.insert((*k).into(), v.clone());
    }
    p
}

pub fn distribution(profile: Profile) -> Distribution {
    Distribution { name: "madar".into(), catalog: catalog(), profile }
}

/// The same, with extra plugins in the catalog (test clocks and ids, or a deployment's own plugins).
pub fn distribution_with(profile: Profile, extra: Vec<Arc<dyn Plugin>>) -> Distribution {
    let mut cat = catalog();
    cat.0.extend(extra);
    Distribution { name: "madar".into(), catalog: cat, profile }
}
pub use util::add_interval;
