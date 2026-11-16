// SPDX-License-Identifier: Apache-2.0
//! Shares (ADR 0084): a page or a Space shown to people outside the app, pinned to a release or live.

use madar_plugins::*;
use nuah_adapters::{AuthPassword, FixedClock, TestClock, TestIds};
use nuah_kernel::*;
use serde_json::{json, Value};
use std::sync::Arc;

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

struct Rig {
    core: Core,
}

fn start(p: Profile) -> Core {
    let clock = FixedClock::at(1_700_000_000_000);
    Core::start(&distribution_with(p, vec![Arc::new(TestClock(clock)), Arc::new(TestIds)])).unwrap_or_else(|e| panic!("{e:#?}"))
}

fn rig() -> Rig {
    Rig { core: start(profile_test(&[("@madar/spaces", json!({}))])) }
}

fn who(n: &str) -> Identity {
    Identity::new(n, n, &["member"])
}

fn doc(text: &str) -> Value {
    json!({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
}

impl Rig {
    fn call(&self, w: &Identity, op: &str, input: Value) -> Result<Value> {
        self.core.call_as(w, op, input, None).map(|r| r.output)
    }
    fn ok(&self, w: &Identity, op: &str, input: Value) -> Value {
        self.call(w, op, input.clone()).unwrap_or_else(|e| panic!("{op} {input} failed: {e}"))
    }
    fn err(&self, w: &Identity, op: &str, input: Value) -> Error {
        self.call(w, op, input).expect_err("expected a failure")
    }
    /// A call with no credential: the public Operations, as a stranger's browser makes them.
    fn public(&self, op: &str, input: Value) -> Result<Value> {
        self.core.call(CallRequest { credential: None, op: op.into(), input, key: None, contract: None }).map(|r| r.output)
    }
    fn page(&self, w: &Identity, title: &str, text: &str, parent: Option<&str>) -> String {
        self.ok(w, "pages.create", json!({"title": title, "body": doc(text), "parent": parent}))["id"].as_str().unwrap().to_string()
    }
    fn edit(&self, w: &Identity, id: &str, text: &str) {
        self.ok(w, "pages.update", json!({"id": id, "body": doc(text)}));
    }
}

fn text_of(opened: &Value) -> String {
    opened["page"]["body"]["content"][0]["content"][0]["text"].as_str().unwrap_or("").to_string()
}

#[test]
fn a_pinned_page_share_shows_the_release_until_it_is_published_again() {
    let r = rig();
    let al = who("alice");
    let p = r.page(&al, "Plan", "first", None);
    let s = r.ok(&al, "shares.create_page", json!({"page": p}));
    assert_eq!((s["mode"].as_str(), s["release"].as_i64(), s["audience"].as_str()), (Some("pinned"), Some(1), Some("anyone")), "pinned to its first release by default");
    let id = s["id"].as_str().unwrap();
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "first", "no sign-in needed");
    r.edit(&al, &p, "second");
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "first", "the share did not move");
    let st = r.ok(&al, "shares.list", json!({"page": p}))["shares"][0].clone();
    assert_eq!(st["id"], json!(id));
    r.ok(&al, "shares.publish", json!({"id": id}));
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "second");
    // an earlier release can be made current again
    r.ok(&al, "shares.publish", json!({"id": id, "release": 1}));
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "first");
    let rel = r.ok(&al, "shares.releases", json!({"id": id}))["releases"].clone();
    assert_eq!(rel.as_array().unwrap().len(), 2);
    assert_eq!(rel[1]["current"], true, "release 1 is the one shown");
}

#[test]
fn a_live_share_shows_the_page_as_it_is_now() {
    let r = rig();
    let al = who("alice");
    let p = r.page(&al, "Notes", "one", None);
    let id = r.ok(&al, "shares.create_page", json!({"page": p, "mode": "live"}))["id"].as_str().unwrap().to_string();
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "one");
    r.edit(&al, &p, "two");
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id})).unwrap()), "two");
}

#[test]
fn sub_pages_are_included_when_asked_and_new_ones_follow_a_live_share_and_a_pinned_one_after_publishing() {
    let r = rig();
    let al = who("alice");
    let top = r.page(&al, "Guide", "top", None);
    let kid = r.page(&al, "Kid", "kid", Some(&top));
    let alone = r.ok(&al, "shares.create_page", json!({"page": top}))["id"].as_str().unwrap().to_string();
    assert_eq!(r.public("shares.open", json!({"id": alone})).unwrap()["tree"].as_array().unwrap().len(), 1, "without the box only the page");
    let live = r.ok(&al, "shares.create_page", json!({"page": top, "mode": "live", "include_children": true}))["id"].as_str().unwrap().to_string();
    let pinned = r.ok(&al, "shares.create_page", json!({"page": top, "include_children": true}))["id"].as_str().unwrap().to_string();
    let n = |id: &str| r.public("shares.open", json!({"id": id})).unwrap()["tree"].as_array().unwrap().len();
    assert_eq!((n(&live), n(&pinned)), (2, 2));
    let newer = r.page(&al, "Newer", "n", Some(&kid));
    assert_eq!((n(&live), n(&pinned)), (3, 2), "a live share has it at once, a pinned one not yet");
    r.ok(&al, "shares.publish", json!({"id": pinned}));
    assert_eq!(n(&pinned), 3);
    // a page of the tree can be asked for by id, one outside it cannot
    assert_eq!(text_of(&r.public("shares.open", json!({"id": live, "page": newer})).unwrap()), "n");
    let other = r.page(&al, "Elsewhere", "x", None);
    assert_eq!(r.public("shares.open", json!({"id": live, "page": other})).unwrap_err().category, Category::NotFound);
}

#[test]
fn a_pin_is_needed_and_only_its_owner_sees_it() {
    let r = rig();
    let al = who("alice");
    let p = r.page(&al, "Private-ish", "secret", None);
    let s = r.ok(&al, "shares.create_page", json!({"page": p, "audience": "pin"}));
    let (id, pin) = (s["id"].as_str().unwrap(), s["pin"].as_str().unwrap().to_string());
    assert!(pin.len() >= 8, "one was made");
    assert_eq!(r.public("shares.open", json!({"id": id})).unwrap_err().reason.as_deref(), Some("shares.pin_required"));
    assert_eq!(r.public("shares.open", json!({"id": id, "pin": "12345678"})).unwrap_err().reason.as_deref(), Some("shares.bad_pin"));
    assert_eq!(text_of(&r.public("shares.open", json!({"id": id, "pin": pin})).unwrap()), "secret");
    assert_eq!(r.err(&al, "shares.create_page", json!({"page": p, "audience": "pin", "pin": "short"})).category, Category::Invalid);
    // the open answer never carries the pin
    assert!(!r.public("shares.open", json!({"id": id, "pin": pin})).unwrap().to_string().contains(&pin));
    // someone else cannot list it
    assert!(r.ok(&who("mallory"), "shares.list", json!({"page": p}))["shares"].as_array().unwrap().is_empty());
}

#[test]
fn an_instance_with_no_accounts_offers_only_anyone_and_a_pin() {
    let r = rig();
    let al = who("alice");
    assert_eq!(r.ok(&al, "shares.options", json!({}))["accounts"], false);
    let p = r.page(&al, "P", "x", None);
    for a in ["accounts", "people"] {
        assert_eq!(r.err(&al, "shares.create_page", json!({"page": p, "audience": a})).reason.as_deref(), Some("shares.no_accounts"), "{a}");
    }
}

fn accounts_rig() -> (Rig, Identity, Identity, Identity) {
    let mut p = profile_test(&[]);
    p.enabled.retain(|e| e != "@nuah/auth-local");
    p.enabled.push("@nuah/auth-password".into());
    let acc = |n: &str| json!({"name": n, "password_hash": AuthPassword::hash_password("passw0rd-long"), "roles": ["member"]});
    p.settings.insert("@nuah/auth-password".into(), json!({"accounts": [acc("alice"), acc("bob"), acc("carol")]}));
    let core = start(p);
    let sign = |n: &str| -> Identity {
        let out = core.call_as(&Identity::new("", "", &[]), "auth.sign_in", json!({"name": n, "password": "passw0rd-long"}), None).unwrap().output;
        serde_json::from_value(out["who"].clone()).unwrap()
    };
    let (a, b, c) = (sign("alice"), sign("bob"), sign("carol"));
    (Rig { core }, a, b, c)
}

#[test]
fn with_accounts_a_share_can_be_for_anyone_signed_in_or_for_named_people() {
    let (r, al, bo, ca) = accounts_rig();
    assert_eq!(r.ok(&al, "shares.options", json!({}))["accounts"], true);
    let p = r.page(&al, "Team page", "hello", None);
    let signed = r.ok(&al, "shares.create_page", json!({"page": p, "audience": "accounts"}))["id"].as_str().unwrap().to_string();
    assert_eq!(r.public("shares.open", json!({"id": signed})).unwrap_err().reason.as_deref(), Some("shares.sign_in"));
    assert_eq!(text_of(&r.ok(&bo, "shares.open_signed", json!({"id": signed}))), "hello");
    let named = r.ok(&al, "shares.create_page", json!({"page": p, "audience": "people", "people": ["bob"]}))["id"].as_str().unwrap().to_string();
    assert_eq!(text_of(&r.ok(&bo, "shares.open_signed", json!({"id": named}))), "hello");
    assert_eq!(r.err(&ca, "shares.open_signed", json!({"id": named})).reason.as_deref(), Some("shares.not_for_you"));
    assert_eq!(r.public("shares.open", json!({"id": named})).unwrap_err().reason.as_deref(), Some("shares.sign_in"));
    assert_eq!(text_of(&r.ok(&al, "shares.open_signed", json!({"id": named}))), "hello", "the person who shared it always may");
    assert_eq!(r.err(&al, "shares.create_page", json!({"page": p, "audience": "people", "people": ["nobody"]})).reason.as_deref(), Some("shares.no_such_person"));
}

#[test]
fn you_cannot_share_a_page_you_cannot_read_and_only_the_sharer_may_change_or_revoke_it() {
    let r = rig();
    let (al, bo) = (who("alice"), who("bob"));
    let p = r.page(&al, "Mine", "x", None);
    assert_eq!(r.err(&bo, "shares.create_page", json!({"page": p})).category, Category::NotFound);
    let id = r.ok(&al, "shares.create_page", json!({"page": p}))["id"].as_str().unwrap().to_string();
    for (op, input) in [("shares.update", json!({"id": id, "audience": "pin"})), ("shares.publish", json!({"id": id})), ("shares.revoke", json!({"id": id})), ("shares.releases", json!({"id": id}))] {
        assert_eq!(r.err(&bo, op, input).category, Category::NotFound, "{op}");
    }
    r.ok(&al, "shares.revoke", json!({"id": id}));
    assert_eq!(r.public("shares.open", json!({"id": id})).unwrap_err().category, Category::NotFound, "the link is gone");
}

#[test]
fn a_reader_learns_nothing_of_the_instance_beyond_the_pages() {
    let r = rig();
    let al = who("alice");
    let p = r.page(&al, "Public", "hi", None);
    let id = r.ok(&al, "shares.create_page", json!({"page": p}))["id"].as_str().unwrap().to_string();
    let out = r.public("shares.open", json!({"id": id})).unwrap().to_string();
    assert!(!out.contains("alice"), "no author: {out}");
    assert!(!out.contains("created_by") && !out.contains("\"owner\""), "{out}");
}

#[test]
fn a_space_site_is_pinned_shows_when_it_is_out_of_date_and_is_managed_by_the_admin() {
    let r = rig();
    let (al, bo, outsider) = (who("alice"), who("bob"), who("dave"));
    let team = r.ok(&al, "spaces.create", json!({"name": "Team"}))["id"].as_str().unwrap().to_string();
    r.ok(&al, "spaces.share", json!({"space": team, "subject": "bob", "role": "member"}));
    let proj = r.ok(&al, "projects.create", json!({"name": "Docs", "space": team}))["id"].as_str().unwrap().to_string();
    let pg = r.ok(&al, "knowledge.create", json!({"project": proj, "title": "Welcome", "body": doc("v1")}))["id"].as_str().unwrap().to_string();
    // only an admin may make the site, with a good, free name
    assert_eq!(r.err(&bo, "shares.create_space", json!({"space": team, "subdomain": "team-docs"})).category, Category::NotFound);
    for bad in ["ab", "Team", "www", "-x-", "a_b"] {
        assert_eq!(r.err(&al, "shares.create_space", json!({"space": team, "subdomain": bad})).reason.as_deref(), Some("shares.bad_subdomain"), "{bad}");
    }
    let site = r.ok(&al, "shares.create_space", json!({"space": team, "subdomain": "team-docs"}));
    assert_eq!((site["mode"].as_str(), site["release"].as_i64()), (Some("pinned"), Some(1)));
    assert_eq!(r.err(&al, "shares.create_space", json!({"space": team, "subdomain": "other-name"})).reason.as_deref(), Some("shares.exists"));
    // anyone reads it by its subdomain: the tree has the project's name and no ids
    let opened = r.public("shares.open", json!({"subdomain": "team-docs"})).unwrap();
    assert_eq!(opened["tree"][0]["group_name"], "Docs");
    assert!(opened["page"].is_null(), "a Space opens at its home, not at a page");
    assert_eq!(text_of(&r.public("shares.open", json!({"subdomain": "team-docs", "page": pg})).unwrap()), "v1");
    // the indicator: current until a page changes, then it counts what changed
    let st = |w: &Identity| r.ok(w, "shares.space", json!({"space": team}));
    assert_eq!(st(&bo)["status"]["current"], true);
    assert_eq!(st(&bo)["admin"], false, "a member sees the state, not the controls");
    r.ok(&al, "knowledge.update", json!({"project": proj, "id": pg, "body": doc("v2")}));
    let s2 = st(&al);
    assert_eq!((s2["status"]["current"].clone(), s2["status"]["changed"].clone()), (json!(false), json!(1)));
    assert_eq!(text_of(&r.public("shares.open", json!({"subdomain": "team-docs", "page": pg})).unwrap()), "v1", "the site did not move");
    // publishing it makes it current again; the earlier release can be chosen back
    r.ok(&al, "shares.publish", json!({"id": site["id"]}));
    assert_eq!(st(&al)["status"]["current"], true);
    assert_eq!(text_of(&r.public("shares.open", json!({"subdomain": "team-docs", "page": pg})).unwrap()), "v2");
    r.ok(&al, "shares.publish", json!({"id": site["id"], "release": 1}));
    assert_eq!(text_of(&r.public("shares.open", json!({"subdomain": "team-docs", "page": pg})).unwrap()), "v1");
    assert_eq!(r.err(&outsider, "shares.space", json!({"space": team})).category, Category::NotFound, "a stranger is told nothing about the Space");
}

#[test]
fn deleting_the_space_takes_its_site_with_it() {
    let r = rig();
    let al = who("alice");
    let team = r.ok(&al, "spaces.create", json!({"name": "Gone"}))["id"].as_str().unwrap().to_string();
    r.ok(&al, "shares.create_space", json!({"space": team, "subdomain": "gone-soon"}));
    assert!(r.public("shares.open", json!({"subdomain": "gone-soon"})).is_ok());
    r.ok(&al, "spaces.delete", json!({"space": team, "cascade": true}));
    for _ in 0..5 {
        if r.core.drain_listeners().unwrap() == 0 {
            break;
        }
    }
    assert_eq!(r.public("shares.open", json!({"subdomain": "gone-soon"})).unwrap_err().category, Category::NotFound);
}

#[test]
fn a_file_is_served_only_when_the_shared_pages_use_it() {
    let r = rig();
    let al = who("alice");
    let up = r.ok(&al, "files.upload", json!({"name": "shot.png", "data": PNG}));
    let fid = up["id"].as_str().unwrap().to_string();
    let body = json!({"type": "doc", "content": [{"type": "image", "attrs": {"src": format!("/files/{fid}")}}]});
    let p = r.ok(&al, "pages.create", json!({"title": "With picture", "body": body}))["id"].as_str().unwrap().to_string();
    let other = r.ok(&al, "files.upload", json!({"name": "other.png", "data": PNG}))["id"].as_str().unwrap().to_string();
    let id = r.ok(&al, "shares.create_page", json!({"page": p}))["id"].as_str().unwrap().to_string();
    let got = r.public("shares.file", json!({"id": id, "file": fid})).unwrap();
    assert_eq!(got["type"], "image/png");
    assert!(got["data"].as_str().unwrap().len() > 10);
    assert_eq!(r.public("shares.file", json!({"id": id, "file": other})).unwrap_err().category, Category::NotFound, "a file the shared pages do not show stays private");
}

#[test]
fn the_class_and_the_settings_of_the_plugin_keep_it_a_feature() {
    assert_eq!(shares::Shares.manifest().class().class, PluginClass::Feature);
}
