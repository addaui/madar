// SPDX-License-Identifier: Apache-2.0
//! `@madar/features` (ADR 0080): the Owner changes feature plugins from the product, never a platform plugin, and the class
//! is the Core's, not the caller's.

use madar_plugins::*;
use nuah_adapters::{FixedClock, TestClock, TestIds};
use nuah_kernel::*;
use nuah_shell::edit::{write_profile, ProfileStore};
use serde_json::{json, Value};
use std::sync::Arc;

struct Rig {
    core: Core,
    path: std::path::PathBuf,
}

fn admin() -> Identity {
    Identity::new("root", "root", &["admin"])
}

fn rig(name: &str) -> Rig {
    let mut p = profile_test(&[]);
    p.enabled.push("@madar/features".into());
    p.grants.insert("@madar/features".into(), vec!["shell".into()]);
    let dir = std::env::temp_dir().join(format!("madar-features-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("madar.json");
    write_profile(&path, &p).unwrap();
    let dist = distribution_with(p.clone(), vec![Arc::new(TestClock(FixedClock::at(1_700_000_000_000))), Arc::new(TestIds)]);
    let store = Arc::new(ProfileStore::new("madar", dist.catalog.clone(), p, path.clone()));
    let core = Core::start(&dist).unwrap_or_else(|e| panic!("{e:#?}"));
    core.attach_shell(store);
    Rig { core, path }
}

impl Rig {
    fn call(&self, who: &Identity, op: &str, input: Value) -> Result<Value> {
        self.core.call_as(who, op, input, None).map(|r| r.output)
    }
    fn ok(&self, op: &str, input: Value) -> Value {
        self.call(&admin(), op, input.clone()).unwrap_or_else(|e| panic!("{op} {input} failed: {e}"))
    }
    fn err(&self, op: &str, input: Value) -> Error {
        self.call(&admin(), op, input).expect_err("expected a failure")
    }
    fn file(&self) -> Value {
        serde_json::from_str(&std::fs::read_to_string(&self.path).unwrap()).unwrap()
    }
    fn on(&self, id: &str) -> bool {
        self.file()["plugins"][id]["enabled"] == true
    }
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap().to_string()).collect()
}

#[test]
fn the_list_splits_the_catalog_by_the_class_the_core_worked_out() {
    let r = rig("list");
    let l = r.ok("features.list", json!({}));
    let (features, platform) = (ids(&l["features"]), ids(&l["platform"]));
    for f in ["@madar/pages", "@madar/task-block", "@nuah/emoji", "@nuah/gifs", "@nuah/gifs-giphy"] {
        assert!(features.contains(&f.to_string()), "{f} should be a feature");
    }
    for p in ["@nuah/db-sqlite", "@nuah/link-analyzer", "@madar/features", "@nuah/auth-password", "@nuah/metric-prometheus"] {
        assert!(platform.contains(&p.to_string()), "{p} should be platform");
    }
    let reasons = l["platform"].as_array().unwrap().iter().find(|p| p["id"] == "@nuah/link-analyzer").unwrap()["reasons"].clone();
    assert_eq!(reasons, json!(["needs the capability net"]));
    let on = l["features"].as_array().unwrap().iter().find(|p| p["id"] == "@madar/pages").unwrap();
    assert_eq!(on["enabled"], true);
    let off = l["features"].as_array().unwrap().iter().find(|p| p["id"] == "@nuah/gifs").unwrap();
    assert_eq!(off["enabled"], false);
    // a plugin the saved file never named came with a newer version: it is marked new, in both lists; one the file names (even switched off) is not
    assert_eq!(on["new"], false);
    let fresh = |l: &Value, group: &str, id: &str| l[group].as_array().unwrap().iter().find(|p| p["id"] == id).map(|p| p["new"].clone());
    assert!(fresh(&l, "features", "@nuah/gifs").is_some());
}

#[test]
fn switching_a_feature_on_and_off_changes_only_its_entry_and_keeps_the_old_file() {
    let r = rig("switch");
    let before = r.file();
    assert!(!r.on("@nuah/gifs-giphy"));
    // a provider brings the feature it plugs into, and a feature that needs a provider alone is refused
    let e = r.err("features.enable", json!({"id": "@nuah/gifs"}));
    assert_eq!(e.reason.as_deref(), Some("features.problems"), "{e}");
    let out = r.ok("features.enable", json!({"id": "@nuah/gifs-giphy"}));
    assert_eq!(out["changed"], json!(["@nuah/gifs-giphy", "@nuah/gifs"]));
    assert!(r.on("@nuah/gifs-giphy") && r.on("@nuah/gifs"));
    // nothing else moved
    let mut after = r.file();
    after["plugins"].as_object_mut().unwrap().remove("@nuah/gifs");
    after["plugins"].as_object_mut().unwrap().remove("@nuah/gifs-giphy");
    let mut was = before.clone();
    was["contract"] = after["contract"].clone();
    assert_eq!(after, was);
    assert!(r.path.with_extension("json.bak").exists(), "the earlier file stays beside the new one");
    // the provider is the last one, so the feature falls with it, and the call must say it knows
    let e = r.err("features.disable", json!({"id": "@nuah/gifs-giphy"}));
    assert_eq!(e.reason.as_deref(), Some("features.needed_by"), "{e}");
    assert!(e.message.contains("@nuah/gifs"), "{}", e.message);
    assert!(r.on("@nuah/gifs-giphy"), "nothing was saved");
    let out = r.ok("features.disable", json!({"id": "@nuah/gifs-giphy", "cascade": true}));
    assert_eq!(out["changed"].as_array().unwrap().len(), 2);
    assert!(!r.on("@nuah/gifs-giphy") && !r.on("@nuah/gifs"));
}

#[test]
fn enabling_a_feature_grants_the_safe_capabilities_it_asks_for_and_nothing_else() {
    let r = rig("grants");
    r.ok("features.disable", json!({"id": "@nuah/emoji"}));
    r.ok("features.enable", json!({"id": "@nuah/emoji"}));
    assert_eq!(r.file()["plugins"]["@nuah/emoji"]["grants"], json!(["call"]));
}

#[test]
fn a_platform_plugin_is_refused_by_every_operation_and_the_file_is_untouched() {
    let r = rig("platform");
    let before = std::fs::read_to_string(&r.path).unwrap();
    for id in ["@nuah/db-memory", "@nuah/link-analyzer", "@madar/features", "@nuah/auth-local"] {
        for (op, input) in [("features.enable", json!({"id": id})), ("features.disable", json!({"id": id})), ("features.configure", json!({"id": id, "settings": {}}))] {
            let e = r.err(op, input);
            assert_eq!(e.reason.as_deref(), Some("features.platform_plugin"), "{op} {id}: {e}");
        }
    }
    assert_eq!(std::fs::read_to_string(&r.path).unwrap(), before);
}

#[test]
fn nothing_in_the_input_can_name_a_class() {
    let r = rig("class-in-input");
    let e = r.err("features.enable", json!({"id": "@nuah/link-analyzer", "class": "feature"}));
    assert_eq!(e.category, Category::Invalid, "an extra field is refused by the input schema: {e}");
}

#[test]
fn an_unknown_plugin_is_not_found() {
    let r = rig("unknown");
    assert_eq!(r.err("features.enable", json!({"id": "@nobody/nothing"})).category, Category::NotFound);
}

#[test]
fn switching_off_something_another_plugin_needs_is_refused_with_the_reason_and_saves_nothing() {
    let r = rig("needed");
    let before = std::fs::read_to_string(&r.path).unwrap();
    let e = r.err("features.disable", json!({"id": "@madar/projects"}));
    assert_eq!(e.reason.as_deref(), Some("features.needed_by"), "{e}");
    assert!(e.message.contains("@madar/tasks"), "{}", e.message);
    assert_eq!(std::fs::read_to_string(&r.path).unwrap(), before);
}

#[test]
fn a_feature_is_configured_by_its_settings_and_a_bad_value_saves_nothing() {
    let r = rig("configure");
    r.ok("features.enable", json!({"id": "@nuah/gifs-giphy"}));
    r.ok("features.configure", json!({"id": "@nuah/gifs-giphy", "settings": {"api_key": "abcdefgh12345678", "rating": "g"}}));
    assert_eq!(r.file()["plugins"]["@nuah/gifs-giphy"]["settings"]["rating"], "g");
    let before = std::fs::read_to_string(&r.path).unwrap();
    let e = r.err("features.configure", json!({"id": "@nuah/gifs-giphy", "settings": {"rating": "x-rated"}}));
    assert_eq!(e.reason.as_deref(), Some("features.problems"), "{e}");
    assert_eq!(std::fs::read_to_string(&r.path).unwrap(), before);
    // the list never hands the secret back
    let l = r.ok("features.list", json!({}));
    let g = l["features"].as_array().unwrap().iter().find(|p| p["id"] == "@nuah/gifs-giphy").unwrap();
    assert!(!g.to_string().contains("abcdefgh12345678"), "{g}");
}

#[test]
fn replace_swaps_two_providers_of_one_point_and_refuses_a_pair_that_shares_none() {
    let r = rig("replace");
    let e = r.err("features.replace", json!({"from": "@madar/pages", "to": "@madar/timeline"}));
    assert_eq!(e.category, Category::Invalid, "{e}");
    let e = r.err("features.replace", json!({"from": "@madar/files", "to": "@nuah/db-memory"}));
    assert_eq!(e.reason.as_deref(), Some("features.platform_plugin"), "{e}");
}

#[test]
fn only_a_person_with_the_permission_may_change_features() {
    let r = rig("permission");
    let member = Identity::new("sam", "sam", &["member"]);
    let e = r.call(&member, "features.enable", json!({"id": "@nuah/gifs"})).expect_err("denied");
    assert_eq!(e.category, Category::Denied);
    assert!(r.call(&member, "features.list", json!({})).is_err());
    assert!(!r.on("@nuah/gifs"));
}

/// The class of every plugin in Madar's catalog, written down (ADR 0080). The Core works it out from the Manifest; this table fails when
/// a change to a plugin (a new capability, a Port, a setting for the operator) moves it to the other side without anyone meaning it.
#[test]
fn the_class_of_every_plugin_in_the_catalog_is_the_one_written_down() {
    const PLATFORM: &[&str] = &[
        "@nuah/db-memory", "@nuah/db-sqlite", "@nuah/db-postgres", "@nuah/auth-local", "@nuah/auth-open", "@nuah/auth-password", "@nuah/policy-allow-all",
        "@nuah/policy-roles", "@nuah/clock-system", "@nuah/ids-random", "@nuah/metric-prometheus", "@nuah/log-console", "@nuah/log-file", "@nuah/net-public",
        "@nuah/link-analyzer", "@nuah/fonts", "@madar/previews", "@madar/quota", "@madar/features",
    ];
    const FEATURE: &[&str] = &[
        "@madar/projects", "@madar/tasks", "@madar/discussion", "@madar/audit", "@nuah/prefs", "@nuah/appearance", "@madar/export", "@madar/notify", "@madar/notify-inbox",
        "@nuah/editor", "@nuah/editor-basic", "@nuah/mermaid", "@nuah/excalidraw", "@nuah/notebook", "@nuah/python", "@madar/task-block", "@madar/refs", "@madar/pages", "@madar/timeline", "@madar/search", "@nuah/emoji", "@madar/files",
        "@madar/files-db", "@nuah/gifs", "@nuah/gifs-giphy", "@madar/spaces", "@madar/shares", "@nuah/entities",
    ];
    for p in catalog().0 {
        let m = p.manifest();
        let c = m.class();
        let want = if m.id.starts_with("@nuah/theme-") || m.id.starts_with("@nuah/fonts-") || FEATURE.contains(&m.id.as_str()) {
            PluginClass::Feature
        } else if PLATFORM.contains(&m.id.as_str()) {
            PluginClass::Platform
        } else {
            panic!("{} has no entry in the class table", m.id)
        };
        assert_eq!(c.class, want, "{}: {:?}", m.id, c.reasons);
    }
}

/// An instance set up before the editor became @nuah/editor (ADR 0094) still starts: its Profile moves to the successors.
#[test]
fn a_profile_with_the_old_editor_plugins_starts() {
    use nuah_shell::Product;
    let mut p = profile_server(":memory:", json!([]));
    for (new, old) in [("@nuah/editor", "@madar/editor"), ("@nuah/editor-basic", "@madar/editor-basic")] {
        p.enabled.retain(|x| x != new);
        p.enabled.push(old.into());
    }
    let cat = Madar.catalog();
    assert!(!Core::check(&Distribution { name: "t".into(), catalog: Catalog(cat.0.clone()), profile: p.clone() }).is_empty());
    let moved = nuah_kernel::successors(&cat, &mut p, &Madar.replaced());
    assert_eq!(moved.len(), 2);
    let problems = Core::check(&Distribution { name: "t".into(), catalog: cat, profile: p });
    assert!(problems.is_empty(), "{problems:#?}");
}
