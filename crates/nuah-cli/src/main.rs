//! `madar`: the command line Face. It is built only on the Link, so the same commands work against
//! a server (`--server`) or a database file opened in this process (`--db`).
//!
//!   madar login NAME            password from $MADAR_PASSWORD or the first line of stdin
//!   madar today | projects | tasks PROJECT | add PROJECT TITLE
//!   madar ops [FILTER] | help OP | call OP key=value ... | watch | who | logout

mod link;

use clap::Parser;
use link::{Http, InProcess, Link};
use nuah_kernel::{contract, Core, Error};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "madar", about = "Madar on the command line")]
struct Args {
    /// A Nu'ah server to talk to.
    #[arg(long, env = "MADAR_SERVER", default_value = "http://127.0.0.1:3000")]
    server: String,
    /// Open this database file in this process instead (one person, always signed in).
    #[arg(long, env = "MADAR_DB")]
    db: Option<String>,
    /// Where the session is kept (default: the user's config directory).
    #[arg(long, env = "MADAR_SESSION")]
    session: Option<PathBuf>,
    command: String,
    rest: Vec<String>,
}

fn session_path(a: &Args) -> PathBuf {
    a.session.clone().unwrap_or_else(|| {
        let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))).unwrap_or_else(|| PathBuf::from("."));
        base.join("nuah").join("session")
    })
}

fn save_session(path: &PathBuf, server: &str, token: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        f.write_all(json!({"server": server, "token": token}).to_string().as_bytes())
    }
    #[cfg(not(unix))]
    std::fs::write(path, json!({"server": server, "token": token}).to_string())
}

fn load_token(path: &PathBuf, server: &str) -> Option<String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    (v["server"] == json!(server)).then(|| v["token"].as_str().map(String::from)).flatten()
}

fn fail(e: &Error) -> ! {
    let reason = e.reason.as_deref().map(|r| format!(" [{r}]")).unwrap_or_default();
    eprintln!("madar: {}{reason}", e.message);
    if e.category == nuah_kernel::Category::Unauthenticated {
        eprintln!("madar: sign in with `madar login NAME`");
    }
    std::process::exit(match e.category {
        nuah_kernel::Category::Invalid => 2,
        nuah_kernel::Category::Unauthenticated | nuah_kernel::Category::Denied => 3,
        nuah_kernel::Category::NotFound => 4,
        nuah_kernel::Category::Conflict => 5,
        _ => 1,
    })
}

fn show(v: &Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn key() -> String {
    // distinct per invocation; retried calls inside one invocation reuse it
    format!("cli-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0))
}

fn main() {
    let a = Args::parse();
    let path = session_path(&a);
    let link: Box<dyn Link> = match &a.db {
        Some(db) => {
            let core = Core::start(&nuah_madar::distribution(nuah_madar::profile_embedded(db))).unwrap_or_else(|p| {
                for p in &p {
                    eprintln!("{}: {}", p.code, p.message);
                }
                std::process::exit(1)
            });
            Box::new(InProcess { core })
        }
        None => Box::new(Http { base: a.server.trim_end_matches('/').to_string(), token: load_token(&path, &a.server) }),
    };
    if let Err(e) = run(&a, &path, link.as_ref()) {
        fail(&e);
    }
}

fn run(a: &Args, path: &PathBuf, link: &dyn Link) -> Result<(), Error> {
    let rest = &a.rest;
    match a.command.as_str() {
        "login" => {
            let name = rest.first().ok_or_else(|| Error::invalid("name", "usage: madar login NAME"))?;
            let password = match std::env::var("MADAR_PASSWORD") {
                Ok(p) => p,
                Err(_) => {
                    let mut s = String::new();
                    std::io::stdin().read_to_string(&mut s).ok();
                    s.lines().next().unwrap_or("").to_string()
                }
            };
            let out = link.call("auth.sign_in", json!({"name": name, "password": password}), None)?;
            let token = out["token"].as_str().ok_or_else(|| Error::internal("no session came back"))?;
            save_session(path, &a.server, token).map_err(|e| Error::internal(format!("cannot save the session: {e}")))?;
            println!("signed in as {}", out["who"]["display"].as_str().unwrap_or(name));
        }
        "logout" => {
            if let Some(t) = load_token(path, &a.server) {
                let _ = link.call("auth.sign_out", json!({"token": t}), None);
            }
            let _ = std::fs::remove_file(path);
            println!("signed out");
        }
        "who" => show(&link.call("auth.who", json!({}), None)?),
        "ops" => {
            let d = link.describe()?;
            let q = rest.first().map(|s| s.to_lowercase());
            for (name, o) in d["operations"].as_object().into_iter().flatten() {
                if q.as_ref().is_some_and(|q| !name.contains(q.as_str())) {
                    continue;
                }
                let mark = if o["allowed"] == json!(false) { " (not for you)" } else { "" };
                println!("{name:<24} {:<8} {}{mark}", o["kind"].as_str().unwrap_or(""), o["description"].as_str().unwrap_or(""));
            }
        }
        "help" => {
            let op = rest.first().ok_or_else(|| Error::invalid("op", "usage: madar help OP"))?;
            let d = link.describe()?;
            let o = d["operations"].get(op).ok_or_else(|| Error::not_found(&format!("operation {op}")))?;
            println!("{op}: {}\nkind: {}  permission: {}", o["description"].as_str().unwrap_or(""), o["kind"].as_str().unwrap_or(""), o["permission"].as_str().unwrap_or("-"));
            for l in contract::describe_input(&o["input"]) {
                println!("  {l}");
            }
            if let Some(r) = o["reasons"].as_object().filter(|r| !r.is_empty()) {
                println!("can fail with:");
                for (code, msg) in r {
                    println!("  {code}  {}", msg.as_str().unwrap_or(""));
                }
            }
        }
        "call" => {
            let op = rest.first().ok_or_else(|| Error::invalid("op", "usage: madar call OP key=value ..."))?;
            let d = link.describe()?;
            let o = d["operations"].get(op).ok_or_else(|| Error::not_found(&format!("operation {op}")))?;
            let input = contract::input_from_args(&o["input"], &rest[1..]).map_err(|m| Error::invalid("input", &m))?;
            let k = (o["kind"] == json!("command")).then(key);
            show(&link.call(op, input, k.as_deref())?);
        }
        "projects" => {
            let out = link.call("projects.list", json!({}), None)?;
            for p in out["projects"].as_array().into_iter().flatten() {
                println!("{}  {}  ({})", p["id"].as_str().unwrap_or(""), p["name"].as_str().unwrap_or(""), p["level"].as_str().unwrap_or(""));
            }
        }
        "tasks" => {
            let project = rest.first().ok_or_else(|| Error::invalid("project", "usage: madar tasks PROJECT"))?;
            let p = link.call("projects.get", json!({"project": project}), None)?;
            let out = link.call("tasks.list", json!({"project": project}), None)?;
            for s in p["statuses"].as_array().into_iter().flatten() {
                println!("{}", s["name"].as_str().unwrap_or("").to_uppercase());
                for t in out["tasks"].as_array().into_iter().flatten().filter(|t| t["status"] == s["id"]) {
                    println!("  {}  {}{}", t["id"].as_str().unwrap_or(""), t["title"].as_str().unwrap_or(""), t["due"].as_str().map(|d| format!("  (due {d})")).unwrap_or_default());
                }
            }
        }
        "add" => {
            let (project, title) = (rest.first(), rest.get(1..).map(|r| r.join(" ")));
            let (Some(project), Some(title)) = (project, title.filter(|t| !t.is_empty())) else { return Err(Error::invalid("title", "usage: madar add PROJECT TITLE")) };
            let t = link.call("tasks.create", json!({"project": project, "title": title}), Some(&key()))?;
            println!("{}", t["id"].as_str().unwrap_or(""));
        }
        "today" => {
            let out = link.call("tasks.my", json!({}), None)?;
            println!("today is {}", out["today"].as_str().unwrap_or(""));
            for bucket in ["overdue", "today", "soon", "later", "undated"] {
                let list: Vec<&Value> = out["tasks"].as_array().into_iter().flatten().filter(|t| t["bucket"] == bucket).collect();
                if list.is_empty() {
                    continue;
                }
                println!("{}", bucket.to_uppercase());
                for t in list {
                    println!("  {} / {}{}", t["project_name"].as_str().unwrap_or(""), t["title"].as_str().unwrap_or(""), t["due"].as_str().map(|d| format!("  (due {d})")).unwrap_or_default());
                }
            }
        }
        "watch" => link.watch(&mut |kind, data| {
            match kind {
                "ready" => eprintln!("watching"),
                "closed" => {
                    eprintln!("the session ended");
                    return false;
                }
                "reset" => println!("reset: reload everything"),
                _ => println!("{} {}", kind, data["data"]),
            }
            true
        })?,
        other => return Err(Error::invalid("command", &format!("unknown command `{other}`; try ops, today, projects, tasks, add, call, watch, login"))),
    }
    Ok(())
}
