//! The resolver's problems as data, and the pure check the setup wizard relies on.

use nuah_kernel::setup::{catalog_info, distribution_from_json, profile_json};
use nuah_kernel::*;
use nuah_madar::*;
use serde_json::json;

fn dist(enabled: &[&str]) -> Distribution {
    let mut d = memory_for_tests();
    d.enabled = enabled.iter().map(|s| s.to_string()).collect();
    d
}

#[test]
fn a_good_profile_has_no_problems_and_a_broken_one_reports_all_of_them_with_kinds_and_plugins() {
    assert!(Core::check(&memory_for_tests()).is_empty());

    // no database, no sign-in, and `export` without the plugin it needs
    let d = dist(&["std", "policy-allow-all", "export"]);
    let problems = Core::check(&d);
    let find = |code: &str| problems.iter().find(|p| p.code == code);
    assert!(find("missing_provider").is_some(), "{problems:#?}");
    let dep = find("missing_dependency").expect("export needs tasks");
    assert_eq!(dep.plugins, ["export", "tasks"]);
    assert!(problems.len() >= 3, "all problems at once: {problems:#?}");

    // two databases and no choice between them
    let mut d = memory_for_tests();
    d.enabled.push("adapter-sqlite".into());
    d.settings.insert("adapter-sqlite".into(), json!({"path": "should-not-be-created.db"}));
    let p = Core::check(&d);
    let amb = p.iter().find(|p| p.code == "ambiguous_binding").expect("ambiguous");
    assert_eq!(amb.plugins, ["adapter-memory", "adapter-sqlite"]);
    // choosing one fixes it
    d.bindings.insert("db".into(), "adapter-sqlite".into());
    assert!(Core::check(&d).is_empty());
    // a binding to something that is not a candidate is its own kind of problem
    d.bindings.insert("db".into(), "std".into());
    assert!(Core::check(&d).iter().any(|p| p.code == "bad_binding"));
}

#[test]
fn checking_never_starts_anything_or_touches_data() {
    let path = std::env::temp_dir().join(format!("nuah-check-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let mut d = memory_for_tests();
    d.enabled.retain(|e| e != "adapter-memory");
    d.enabled.push("adapter-sqlite".into());
    d.settings.insert("adapter-sqlite".into(), json!({"path": path.display().to_string()}));
    assert!(Core::check(&d).is_empty());
    assert!(!path.exists(), "check must not open the database file");
}

#[test]
fn bad_settings_are_reported_against_their_plugin() {
    let mut d = memory_for_tests();
    d.enabled.retain(|e| e != "auth-local");
    d.enabled.push("auth-token".into());
    d.settings.insert("auth-token".into(), json!({"tokens": 5}));
    let p = Core::check(&d);
    let s = p.iter().find(|p| p.code == "bad_settings").unwrap_or_else(|| panic!("{p:#?}"));
    assert_eq!(s.plugins, ["auth-token"]);
}

#[test]
fn profiles_are_read_strictly_and_round_trip() {
    let typo = json!({"name": "x", "enabeld": ["std"]});
    let err = |v: serde_json::Value| distribution_from_json(catalog(), &v).err();
    assert!(err(typo).unwrap().contains("unknown key `enabeld`"));
    assert!(err(json!({"name": "x", "enabled": "std"})).is_some());
    assert!(err(json!({"name": " "})).is_some());
    let d = memory_for_tests();
    let back = distribution_from_json(catalog(), &profile_json(&d)).unwrap();
    assert_eq!((back.name, back.enabled), (d.name.clone(), d.enabled.clone()));
    let info = catalog_info(&d);
    let tasks = info["plugins"].as_array().unwrap().iter().find(|p| p["id"] == "tasks").unwrap();
    assert!(!tasks["description"].as_str().unwrap().is_empty());
    assert!(info["plugins"].as_array().unwrap().iter().all(|p| !p["description"].as_str().unwrap_or("").is_empty()), "every catalog plugin says what it is");
}
