// SPDX-License-Identifier: Apache-2.0
//! `previews`: what a web address looks like, for the editor's link block ([ADR 0026], [ADR 0040]).
//!
//! One outbound Operation. It runs outside any transaction (a slow site must never hold the database) and
//! reaches the web only through the `net` Port, so which addresses may be reached is the Adapter's rule, not
//! this plugin's. The plugin being enabled is the switch: a distribution that does not want its server making
//! outbound requests leaves it out, and so needs no `net` Adapter.
//!
//! [ADR 0026]: https://docs.addaui.com/nuah/adr/0026-files-follow-the-pages-that-use-them-and-link-previews-are-fetched-by-a-guarded-provider/
//! [ADR 0040]: https://docs.addaui.com/nuah/adr/0040-outbound-operations-run-outside-the-transaction-and-reach-the-network-through-a-net-port/

use nuah_kernel::*;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const MAX_BODY: usize = 512 * 1024;
const TTL: Duration = Duration::from_secs(24 * 3600);
const CACHE_MAX: usize = 2000;

fn clean(s: &str, max: usize) -> String {
    let mut plain = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => plain.push(c),
            _ => {}
        }
    }
    let plain = decode(&plain);
    let words: Vec<&str> = plain.split_whitespace().collect();
    let joined: String = words.join(" ").chars().filter(|c| !c.is_control()).collect();
    if joined.chars().count() > max { format!("{}…", joined.chars().take(max - 1).collect::<String>()) } else { joined }
}

fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|e| *e <= 10);
        let Some(e) = end else { out.push('&'); rest = &rest[1..]; continue };
        let ent = &rest[1..e];
        let ch = match ent {
            "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" => Some('\''), "nbsp" => Some(' '),
            _ => ent.strip_prefix('#').and_then(|n| match n.strip_prefix(['x', 'X']) { Some(h) => u32::from_str_radix(h, 16).ok(), None => n.parse().ok() }).and_then(char::from_u32),
        };
        match ch {
            Some(c) => { out.push(c); rest = &rest[e + 1..]; }
            None => { out.push('&'); rest = &rest[1..]; }
        }
    }
    out.push_str(rest);
    out
}

/// Where a tag ends: the first `>` that is not inside quotes.
fn tag_end(s: &str) -> Option<usize> {
    let mut q: Option<char> = None;
    for (i, c) in s.char_indices() {
        match (q, c) {
            (None, '"' | '\'') => q = Some(c),
            (Some(o), c) if c == o => q = None,
            (None, '>') => return Some(i),
            _ => {}
        }
    }
    None
}

/// The attributes of one tag's text, lower-cased names.
fn attrs(tag: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let b: Vec<char> = tag.chars().collect();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_whitespace() || b[i] == '/') { i += 1; }
        let s = i;
        while i < b.len() && !b[i].is_whitespace() && b[i] != '=' && b[i] != '/' { i += 1; }
        let name: String = b[s..i].iter().collect::<String>().to_lowercase();
        while i < b.len() && b[i].is_whitespace() { i += 1; }
        let mut val = String::new();
        if i < b.len() && b[i] == '=' {
            i += 1;
            while i < b.len() && b[i].is_whitespace() { i += 1; }
            if i < b.len() && (b[i] == '"' || b[i] == '\'') {
                let q = b[i];
                i += 1;
                let vs = i;
                while i < b.len() && b[i] != q { i += 1; }
                val = b[vs..i.min(b.len())].iter().collect();
                i += 1;
            } else {
                let vs = i;
                while i < b.len() && !b[i].is_whitespace() { i += 1; }
                val = b[vs..i].iter().collect();
            }
        }
        if !name.is_empty() { m.entry(name).or_insert(val); }
    }
    m
}

/// What the page says about itself. Pure: no network, no markup survives.
pub fn parse(html: &str, base: &url::Url) -> Value {
    let lower = html.to_lowercase();
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut from = 0;
    // `to_lowercase` can change byte lengths for odd characters; only use the lowered copy for finding tags
    // when it kept the length, otherwise search the original case-sensitively.
    let hay = if lower.len() == html.len() { lower.as_str() } else { html };
    while let Some(i) = hay[from..].find("<meta") {
        let start = from + i + 5;
        let Some(end) = tag_end(&html[start..]) else { break };
        let a = attrs(&html[start..start + end]);
        let key = a.get("property").or_else(|| a.get("name")).map(|s| s.to_lowercase());
        if let (Some(k), Some(c)) = (key, a.get("content")) {
            meta.entry(k).or_insert_with(|| c.clone());
        }
        from = start + end;
    }
    let title_tag = hay.find("<title").and_then(|i| {
        let s = html[i..].find('>')? + i + 1;
        let e = hay[s..].find("</title")? + s;
        Some(html[s..e].to_string())
    });
    let pick = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k).filter(|v| !v.trim().is_empty()).cloned());
    let title = pick(&["og:title", "twitter:title"]).or(title_tag).map(|t| clean(&t, 200)).filter(|t| !t.is_empty());
    let description = pick(&["og:description", "twitter:description", "description"]).map(|t| clean(&t, 300)).filter(|t| !t.is_empty());
    let site = pick(&["og:site_name"]).map(|t| clean(&t, 80)).filter(|t| !t.is_empty()).or_else(|| base.host_str().map(|h| h.trim_start_matches("www.").to_string()));
    let image = pick(&["og:image", "og:image:url", "twitter:image"])
        .and_then(|i| base.join(decode(i.trim()).as_str()).ok())
        .filter(|u| u.scheme() == "https" && u.as_str().len() <= 500 && u.username().is_empty())
        .map(|u| u.to_string());
    json!({"url": base.as_str(), "title": title.unwrap_or_else(|| base.host_str().unwrap_or("").to_string()), "description": description, "site": site, "image": image})
}

type Cache = Arc<Mutex<HashMap<String, (Instant, Value)>>>;

/// The plugin. It keeps the answers it has already worked out for a day.
#[derive(Default)]
pub struct Previews {
    cache: Cache,
}

fn unavailable() -> Error {
    Error::reason(Category::NotFound, "previews.unavailable", "No preview could be made for that address")
}

impl Plugin for Previews {
    fn manifest(&self) -> Manifest {
        serde_json::from_value(json!({
            "id": "@madar/previews", "version": "0.2.0", "name": "Link previews", "namespaces": ["previews"],
            "description": "Title, summary and picture of a web address, for the editor's link block. Makes outbound web requests through the net Port.",
            "requires": {"capabilities": ["net"]},
            "operations": {
                "previews.get": {"kind": "outbound", "description": "The card for a public http/https address: its own title, summary and picture.",
                    "reasons": {"previews.unavailable": "No preview could be made for that address"},
                    "input": {"type":"object","required":["url"],"properties":{"url":{"type":"string","maxLength":2000}},"additionalProperties":false},
                    "output": {"type":"object","required":["url","title"]}}
            }
        }))
        .expect("previews manifest")
    }

    fn bind(&self, b: &mut Bindings) {
        let cache = self.cache.clone();
        b.outbound("previews.get", move |cx, i| {
            let url = url::Url::parse(i["url"].as_str().unwrap_or("").trim()).ok().filter(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some()).ok_or_else(|| Error::invalid("url", "is not a web address"))?;
            let key = url.as_str().to_string();
            if let Some((at, v)) = cache.lock().get(&key) {
                if at.elapsed() < TTL {
                    return Ok(v.clone());
                }
            }
            let req = NetRequest { max_bytes: MAX_BODY, ..NetRequest::get(&key) }.header("Accept", "text/html,application/xhtml+xml");
            let resp = cx.net()?.fetch(&req).map_err(|e| if e.reason.as_deref() == Some("net.refused") { Error::invalid("url", "is not a public web address") } else { unavailable() })?;
            let html = resp.header("content-type").is_some_and(|t| t.to_lowercase().starts_with("text/html") || t.to_lowercase().starts_with("application/xhtml"));
            if !(200..300).contains(&resp.status) || !html {
                return Err(unavailable());
            }
            let base = url::Url::parse(&resp.url).unwrap_or(url);
            let out = parse(&String::from_utf8_lossy(&resp.body), &base);
            let mut c = cache.lock();
            if c.len() >= CACHE_MAX {
                c.retain(|_, (at, _)| at.elapsed() < TTL);
                if c.len() >= CACHE_MAX {
                    c.clear();
                }
            }
            c.insert(key, (Instant::now(), out.clone()));
            Ok(out)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_read_for_its_own_words_and_no_markup_survives() {
        let base = url::Url::parse("https://www.example.com/post/1").unwrap();
        let html = r#"<html><head><title> Fallback </title>
            <meta property="og:title" content="Hello &amp; <b>welcome</b> &#8212; &#x41;">
            <META name="description" content="  Plain
              words   here ">
            <meta property='og:image' content='/img/a.png'>
            <meta property="og:site_name" content="Example"></head><body>x</body></html>"#;
        let v = parse(html, &base);
        assert_eq!(v["title"], "Hello & welcome — A");
        assert_eq!(v["description"], "Plain words here");
        assert_eq!(v["image"], "https://www.example.com/img/a.png");
        assert_eq!(v["site"], "Example");
        let bare = parse("<title>Only a title</title>", &base);
        assert_eq!(bare["title"], "Only a title");
        assert_eq!(bare["site"], "example.com");
        assert!(bare["image"].is_null());
        // an http picture or a script address is never passed on; no title falls back to the host
        let v = parse(r#"<meta property="og:image" content="http://example.com/a.png"><meta property="og:title" content="">"#, &base);
        assert!(v["image"].is_null());
        assert_eq!(v["title"], "www.example.com");
        assert!(parse(r#"<meta property="og:image" content="javascript:alert(1)">"#, &base)["image"].is_null());
        let long = format!("<title>{}</title>", "ab".repeat(300));
        assert_eq!(parse(&long, &base)["title"].as_str().unwrap().chars().count(), 200);
        // odd input never panics
        for junk in ["<meta", "<meta content=", "<title>", "<title></title", "<meta property=og:title content=ü>", "İ<title>x</title>", "&", "&#99999999999;"] {
            let _ = parse(junk, &base);
        }
    }
}
