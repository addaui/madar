// SPDX-License-Identifier: Apache-2.0
//! `previews`: what a web address looks like, for the editor's link block (ADR 0026).
//!
//! The network is touched only by [`Fetcher`], which the *server* owns and runs outside any transaction (a slow
//! site must never hold the database). The `previews` plugin is the front door: it names the Operation, so who
//! may ask is decided like everything else, and it can be switched off like everything else.

use nuah_kernel::*;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use ureq::ResponseExt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

pub const MAX_BODY: u64 = 512 * 1024;
const TTL: Duration = Duration::from_secs(24 * 3600);
const CACHE_MAX: usize = 2000;

/// An address a link preview may never connect to: this machine, the private network, link-local (cloud
/// metadata lives at 169.254.169.254), carrier-grade NAT, multicast, or an IPv4 address dressed as IPv6.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => public_v4(a),
        IpAddr::V6(a) => {
            if let Some(v4) = a.to_ipv4_mapped() {
                return public_v4(v4);
            }
            let s = a.segments();
            !(a.is_unspecified() || a.is_loopback() || a.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || s[0] == 0x2001 && s[1] == 0x0db8 // documentation
                || (s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0xffff) // v4-mapped, handled above
                || (s[0] == 0x0064 && s[1] == 0xff9b) // NAT64 can reach v4 private hosts
                || a == Ipv6Addr::LOCALHOST)
        }
    }
}

fn public_v4(a: Ipv4Addr) -> bool {
    let o = a.octets();
    !(a.is_unspecified() || a.is_loopback() || a.is_private() || a.is_link_local() || a.is_multicast() || a.is_broadcast()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64/10 carrier-grade NAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18/15 benchmarking
        || o[0] >= 240)
}

/// A refused address, as the user sees it: always the same, so the answer says nothing about the inside.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Invalid,
    RateLimited,
    Unavailable,
}

/// The address must be a plain public web address: http or https, no credentials, port 80 or 443.
pub fn check_url(raw: &str, allow_private: bool) -> std::result::Result<url::Url, Refusal> {
    if raw.len() > 2000 {
        return Err(Refusal::Invalid);
    }
    let u = url::Url::parse(raw.trim()).map_err(|_| Refusal::Invalid)?;
    if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some() || u.host_str().is_none() {
        return Err(Refusal::Invalid);
    }
    if !allow_private {
        if !matches!(u.port_or_known_default(), Some(80) | Some(443)) {
            return Err(Refusal::Invalid);
        }
        match u.host() {
            Some(url::Host::Ipv4(a)) if !is_public(IpAddr::V4(a)) => return Err(Refusal::Invalid),
            Some(url::Host::Ipv6(a)) if !is_public(IpAddr::V6(a)) => return Err(Refusal::Invalid),
            Some(url::Host::Domain(d)) if d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") || d.ends_with(".internal") => return Err(Refusal::Invalid),
            _ => {}
        }
    }
    Ok(u)
}

/// Resolves names like the system does, then keeps only public addresses. The HTTP client connects with
/// what this returns, so a redirect or a changed DNS answer is checked at the moment it is used.
#[derive(Debug)]
struct PublicOnly {
    inner: ureq::unversioned::resolver::DefaultResolver,
    allow_private: bool,
}

impl ureq::unversioned::resolver::Resolver for PublicOnly {
    fn resolve(&self, uri: &ureq::http::Uri, config: &ureq::config::Config, timeout: ureq::unversioned::transport::NextTimeout) -> std::result::Result<ureq::unversioned::resolver::ResolvedSocketAddrs, ureq::Error> {
        let found = self.inner.resolve(uri, config, timeout)?;
        if self.allow_private {
            return Ok(found);
        }
        if !matches!(uri.port_u16().or(match uri.scheme_str() { Some("https") => Some(443), Some("http") => Some(80), _ => None }), Some(80) | Some(443)) {
            return Err(ureq::Error::HostNotFound);
        }
        let mut out = self.empty();
        for a in found.iter().filter(|a: &&SocketAddr| is_public(a.ip())) {
            out.push(*a);
        }
        if out.is_empty() { Err(ureq::Error::HostNotFound) } else { Ok(out) }
    }
}

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

/// Fetches previews with every protection in ADR 0026. Cheap to share: caches and counts inside.
pub struct Fetcher {
    agent: ureq::Agent,
    allow_private: bool,
    per_minute: usize,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
    asked: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl Fetcher {
    pub fn new(allow_private: bool, per_minute: usize) -> Self {
        let config = ureq::config::Config::builder()
            .proxy(None)
            .max_redirects(3)
            .timeout_global(Some(Duration::from_secs(5)))
            .http_status_as_error(true)
            .user_agent("Mozilla/5.0 (compatible; NuahLinkPreview/0.2)")
            .build();
        let resolver = PublicOnly { inner: Default::default(), allow_private };
        let agent = ureq::Agent::with_parts(config, ureq::unversioned::transport::DefaultConnector::new(), resolver);
        Fetcher { agent, allow_private, per_minute, cache: Default::default(), asked: Default::default() }
    }

    /// The preview for `raw`, asked for by `person`. Blocks; call it off the async threads.
    pub fn get(&self, person: &str, raw: &str) -> std::result::Result<Value, Refusal> {
        let url = check_url(raw, self.allow_private)?;
        let key = url.as_str().to_string();
        if let Some((at, v)) = self.cache.lock().get(&key) {
            if at.elapsed() < TTL {
                return Ok(v.clone());
            }
        }
        {
            let mut asked = self.asked.lock();
            let q = asked.entry(person.to_string()).or_default();
            while q.front().is_some_and(|t| t.elapsed() > Duration::from_secs(60)) {
                q.pop_front();
            }
            if q.len() >= self.per_minute {
                return Err(Refusal::RateLimited);
            }
            q.push_back(Instant::now());
            if asked.len() > 5000 {
                asked.retain(|_, q| q.back().is_some_and(|t| t.elapsed() < Duration::from_secs(60)));
            }
        }
        let resp = self.agent.get(url.as_str()).header("Accept", "text/html,application/xhtml+xml").call().map_err(|_| Refusal::Unavailable)?;
        let ty = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
        if !(ty.starts_with("text/html") || ty.starts_with("application/xhtml")) {
            return Err(Refusal::Unavailable);
        }
        let final_url = url::Url::parse(&resp.get_uri().to_string()).unwrap_or(url);
        let mut buf = vec![];
        resp.into_body().into_reader().take(MAX_BODY).read_to_end(&mut buf).map_err(|_| Refusal::Unavailable)?;
        let out = parse(&String::from_utf8_lossy(&buf), &final_url);
        let mut c = self.cache.lock();
        if c.len() >= CACHE_MAX {
            c.retain(|_, (at, _)| at.elapsed() < TTL);
            if c.len() >= CACHE_MAX { c.clear(); }
        }
        c.insert(key, (Instant::now(), out.clone()));
        Ok(out)
    }
}

/// The plugin: names the Operation so access and switching off work as everywhere else. It does no fetching;
/// the server does, after this Operation says the caller may ask.
pub struct Previews;
impl Plugin for Previews {
    fn manifest(&self) -> Manifest {
        manifest_of(json!({
            "id": "previews", "version": "0.1.0", "name": "Link previews", "namespaces": ["previews"],
            "description": "Title, summary and picture of a web address, for the editor's link block. Off by default: with `fetch` set the server fetches the page, otherwise it answers a plain card.",
            "settings_schema": {"type": "object", "properties": {"fetch": {"type": "boolean", "description": "Fetch the page behind a link to show its title, summary and picture. The server then makes outbound web requests (public addresses only, rate limited; ADR 0026).", "default": false}}, "additionalProperties": false},
            "operations": {
                "previews.get": {"kind": "query", "description": "A card for a public http/https address. The server's POST /previews adds the page's own title, summary and picture.",
                    "reasons": {"previews.unavailable": "No preview could be made for that address", "previews.rate_limited": "Too many previews just now, try again in a minute"},
                    "input": {"type":"object","required":["url"],"properties":{"url":{"type":"string","maxLength":2000}},"additionalProperties":false},
                    "output": {"type":"object","required":["url","title"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        // The plain card: no network. The server's POST /previews calls this first (it settles who may ask and
        // whether the plugin is on), then fetches the rich one.
        b.op("previews.get", |tx, i| {
            // Only the shape here; whether the address is public is the fetcher's call (a test may allow loopback).
            let u = check_url(i["url"].as_str().unwrap_or(""), true).map_err(|_| Error::invalid("url", "is not a web address"))?;
            Ok(json!({"url": u.as_str(), "title": u.host_str().unwrap_or(""), "site": u.host_str().unwrap_or(""), "description": null, "image": null,
                "fetch": tx.settings()["fetch"].as_bool().unwrap_or(false)}))
        });
    }
}

fn manifest_of(v: Value) -> Manifest {
    serde_json::from_value(v).expect("previews manifest")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_special_addresses_are_refused() {
        for bad in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1"] {
            assert!(!is_public(bad.parse().unwrap()), "{bad} must be refused");
        }
        for good in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"] {
            assert!(is_public(good.parse().unwrap()), "{good} is public");
        }
    }

    #[test]
    fn the_client_itself_refuses_to_connect_to_private_addresses_even_when_a_redirect_points_there() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let mut s = s;
                let mut b = [0u8; 512];
                let _ = s.read(&mut b);
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
            }
        });
        let url = format!("http://127.0.0.1:{port}/");
        // bypass `check_url` on purpose: this is the second line of defence, the one a redirect meets
        assert!(Fetcher::new(false, 5).agent.get(&url).call().is_err(), "the resolver filters loopback");
        assert!(Fetcher::new(true, 5).agent.get(&url).call().is_ok(), "and only the test setting lets it through");
    }

    #[test]
    fn only_plain_public_web_addresses_pass() {
        assert!(check_url("https://example.com/a?b=1", false).is_ok());
        assert!(check_url("http://example.com:80/", false).is_ok());
        for bad in ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com", "https://user@example.com", "http://example.com:8080/", "http://127.0.0.1/", "http://[::1]/", "http://localhost/", "http://a.localhost/", "http://169.254.169.254/latest/meta-data", "http://printer.local/", "nonsense", "", "https://"] {
            assert!(check_url(bad, false).is_err(), "{bad} must be refused");
        }
        assert!(check_url("http://127.0.0.1:8080/", true).is_ok(), "tests may reach a local server");
    }

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

impl std::fmt::Debug for Fetcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Fetcher").field("allow_private", &self.allow_private).finish()
    }
}
