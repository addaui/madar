// SPDX-License-Identifier: Apache-2.0
//! Madar v2: a task manager built as plugins on the Nuah kernel.
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
pub mod product;
pub use product::{full_catalog, routes, Madar, Web};

use nuah_adapters::*;
use nuah_kernel::*;
use serde_json::json;
use std::sync::Arc;

/// Every plugin Madar ships, plus the adapters it can run on.
pub fn catalog() -> Catalog {
    let mut list: Vec<Arc<dyn Plugin>> = vec![
        Arc::new(AdapterMemory), Arc::new(AdapterSqlite), Arc::new(AdapterPostgres), Arc::new(AuthLocal), Arc::new(AuthPassword),
        Arc::new(PolicyAllowAll), Arc::new(PolicyRoles), Arc::new(StdClock), Arc::new(StdIds),
        Arc::new(projects::Projects), Arc::new(tasks::Tasks), Arc::new(discussion::Discussion),
        Arc::new(small::Audit), Arc::new(small::Quota), Arc::new(nuah_prefs::Prefs), Arc::new(nuah_appearance::Appearance), Arc::new(nuah_metric_prometheus::MetricPrometheus), Arc::new(LogConsole), Arc::new(LogFile), Arc::new(small::Export),
        Arc::new(small::Notify), Arc::new(small::NotifyInbox),
        Arc::new(content::Editor), Arc::new(content::EditorBasic), Arc::new(content::Refs), Arc::new(pages::Pages), Arc::new(timeline::Timeline), Arc::new(search::Search), Arc::new(files::Files), Arc::new(files::FilesDb), Arc::new(previews::Previews::default()), Arc::new(NetPublic::default()), Arc::new(workspaces::Workspaces),
    ];
    for t in nuah_appearance::themes() {
        list.push(Arc::new(t));
    }
    Catalog(list)
}

const FEATURES: [&str; 19] = ["@madar/projects", "@madar/tasks", "@madar/discussion", "@madar/audit", "@madar/quota", "@nuah/prefs", "@madar/export", "@madar/notify", "@madar/notify-inbox", "@nuah/appearance", "@madar/editor", "@madar/editor-basic", "@madar/refs", "@madar/pages", "@madar/timeline", "@madar/workspaces", "@madar/search", "@madar/files", "@madar/files-db"];

fn base_profile(name: &str, adapters: &[&str]) -> Profile {
    let mut enabled: Vec<String> = adapters.iter().map(|s| s.to_string()).collect();
    enabled.extend(FEATURES.iter().map(|s| s.to_string()));
    enabled.extend(nuah_appearance::theme_ids());
    let mut p = Profile { name: name.into(), enabled, ..Default::default() };
    p.grants.insert("@madar/projects".into(), vec!["emit".into()]);
    p.grants.insert("@madar/tasks".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("@madar/discussion".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("@nuah/prefs".into(), vec!["emit".into()]);
    p.grants.insert("@nuah/appearance".into(), vec!["emit".into()]);
    p.grants.insert("@madar/pages".into(), vec!["emit".into(), "call".into()]);
    p.grants.insert("@madar/search".into(), vec!["call".into()]);
    p.grants.insert("@madar/files".into(), vec!["call".into()]);
    p.grants.insert("@madar/timeline".into(), vec!["call".into()]);
    p.grants.insert("@madar/workspaces".into(), vec!["emit".into()]);
    p.grants.insert("@madar/export".into(), vec!["call".into()]);
    p.grants.insert("@madar/notify-inbox".into(), vec!["emit".into()]);
    p
}

/// One person, one file, always signed in. For a Core only that person can reach.
pub fn profile_embedded(db_path: &str) -> Profile {
    let mut p = base_profile("embedded", &["@nuah/db-sqlite", "@nuah/auth-local", "@nuah/policy-roles", "@nuah/clock-system", "@nuah/ids-random", "@nuah/log-console"]);
    p.settings.insert("@nuah/db-sqlite".into(), json!({"path": db_path}));
    p
}

/// Several people with passwords. `accounts` are `{name, password_hash, roles}`. `db` is the path of a SQLite
/// file, or a `postgres://` URL to run on PostgreSQL (one Madar process per database).
pub fn profile_server(db: &str, accounts: serde_json::Value) -> Profile {
    let postgres = db.starts_with("postgres://") || db.starts_with("postgresql://");
    let adapter = if postgres { "@nuah/db-postgres" } else { "@nuah/db-sqlite" };
    let mut p = base_profile("server", &[adapter, "@nuah/auth-password", "@nuah/policy-roles", "@nuah/clock-system", "@nuah/ids-random", "@nuah/log-console"]);
    p.settings.insert(adapter.into(), if postgres { json!({"url": db}) } else { json!({"path": db}) });
    p.settings.insert("@nuah/auth-password".into(), json!({"accounts": accounts}));
    p.settings.insert("@madar/quota".into(), json!({"max_tasks": 5000}));
    p.enabled.push("@madar/quota".into());
    p
}

/// In memory with predictable ids and a clock the test controls.
pub fn profile_test(extra_settings: &[(&str, serde_json::Value)]) -> Profile {
    let mut p = base_profile("test", &["@nuah/db-memory", "@nuah/auth-local", "@nuah/policy-roles", "@nuah/clock-fixed", "@nuah/ids-sequential"]);
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
