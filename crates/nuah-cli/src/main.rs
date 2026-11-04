//! `madar`: the command-line face. It is written against the Link trait only.
//! With --remote it talks to a hosted core; without, it embeds the core in this process
//! (a coupled app, no server, works offline). Every command below behaves the same either way.

use clap::{Parser, Subcommand};
use nuah_client::{connect, Link};
use nuah_kernel::LinkError;
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "madar", version, about = "Madar tasks from the terminal")]
struct Cli {
    /// Talk to a hosted core, for example http://127.0.0.1:8787. Omit to embed the core.
    #[arg(long, env = "NUAH_REMOTE", global = true)]
    remote: Option<String>,
    /// Access token (hosted cores that require sign-in).
    #[arg(long, env = "NUAH_TOKEN", global = true)]
    token: Option<String>,
    /// Database file for the embedded core.
    #[arg(long, env = "NUAH_DB", global = true)]
    db: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a project, or list them
    Project {
        #[command(subcommand)]
        cmd: ProjectCmd,
    },
    /// Add a task to a project (by name or id prefix)
    Add {
        project: String,
        title: String,
        #[arg(short, long)]
        priority: Option<i64>,
        #[arg(short, long)]
        due: Option<String>,
        #[arg(long)]
        desc: Option<String>,
    },
    /// List tasks
    List {
        #[arg(short, long)]
        project: Option<String>,
        #[arg(short, long)]
        status: Option<String>,
        #[arg(short, long)]
        query: Option<String>,
    },
    /// Show a task with its comments and follow-ups
    Show { task: String },
    /// Move a task to a status
    Move { task: String, status: String },
    /// Move a task to its project's last status
    Done { task: String },
    /// Change fields of a task
    Edit {
        task: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(short, long)]
        priority: Option<i64>,
        #[arg(short, long)]
        due: Option<String>,
        #[arg(long)]
        clear_due: bool,
        #[arg(long)]
        desc: Option<String>,
    },
    /// Delete a task
    Rm { task: String },
    /// Comment on a task, or reply with --reply-to
    Comment {
        task: String,
        text: String,
        #[arg(long)]
        reply_to: Option<String>,
    },
    /// Record a follow-up on a task
    Followup { task: String, text: String },
    /// Show the audit log, optionally for one task
    Audit { task: Option<String> },
    /// Watch live events (Pulse). Resume with --after N.
    Watch {
        #[arg(long)]
        after: Option<u64>,
    },
    /// Print what the core says about itself
    Describe,
}

#[derive(Subcommand)]
enum ProjectCmd {
    Add {
        name: String,
        /// Repeat to set the statuses, first to last. The last one means done.
        #[arg(short, long)]
        status: Vec<String>,
    },
    List,
}

type R<T> = Result<T, LinkError>;

fn main() {
    let cli = Cli::parse();
    let db_path = cli.db.clone().unwrap_or_else(default_db);
    let link = match connect(
        cli.remote.as_deref(),
        cli.token.clone(),
        || {
            if let Some(dir) = db_path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            nuah_madar::start(nuah_madar::embedded(&db_path.to_string_lossy(), "Me"))
        },
        "cli",
    ) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1)
        }
    };
    if let Err(e) = run(&*link, cli.cmd) {
        eprintln!("error: {}", e.message);
        std::process::exit(match e.code.as_str() {
            "unauthenticated" => 3,
            "permission_denied" => 4,
            "not_found" => 5,
            "transport" => 6,
            _ => 1,
        });
    }
}

fn default_db() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("nuah-madar").join("madar.db")
}

/// Commands that change data carry a fresh key, so a retry after a dropped connection is safe.
fn key() -> String {
    let ns = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("cli-{}-{ns}", std::process::id())
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Accept a full id, an unambiguous id prefix (4+ characters), an exact name, or a unique
/// piece of the name. `name_field` is the human label of the entity ("name" or "title").
fn pick(items: &Value, what: &str, wanted: &str, name_field: Option<&str>) -> R<Value> {
    let list = items.as_array().cloned().unwrap_or_default();
    let lower = wanted.to_lowercase();
    let label = |i: &Value| name_field.map(|f| s(i, f).to_lowercase()).unwrap_or_default();
    let unique = |found: Vec<&Value>| -> Option<R<Value>> {
        match found.len() {
            0 => None,
            1 => Some(Ok(found[0].clone())),
            _ => Some(Err(LinkError::conflict(format!(
                "`{wanted}` matches several {what}s: {}",
                found.iter().map(|i| if name_field.is_some() { format!("\"{}\"", s(i, name_field.unwrap())) } else { short(&s(i, "id")).to_string() }).collect::<Vec<_>>().join(", ")
            )))),
        }
    };
    if name_field.is_some() {
        if let Some(r) = unique(list.iter().filter(|i| label(i) == lower).collect()) {
            return r;
        }
    }
    if wanted.len() >= 4 {
        if let Some(r) = unique(list.iter().filter(|i| s(i, "id").starts_with(wanted)).collect()) {
            return r;
        }
    }
    if name_field.is_some() {
        if let Some(r) = unique(list.iter().filter(|i| label(i).contains(&lower)).collect()) {
            return r;
        }
    }
    Err(LinkError::not_found(&format!("{what} `{wanted}`")))
}

fn project_of(link: &dyn Link, wanted: &str) -> R<Value> {
    pick(&link.call("projects.list", json!({}), None)?, "project", wanted, Some("name"))
}

fn task_of(link: &dyn Link, wanted: &str) -> R<Value> {
    pick(&link.call("tasks.list", json!({"limit": 500}), None)?, "task", wanted, Some("title"))
}

fn short(id: &str) -> &str {
    &id[..id.len().min(8)]
}

fn task_line(t: &Value) -> String {
    let due = t["due"].as_str().map(|d| format!("  due {d}")).unwrap_or_default();
    let mark = if t["completed_at"].is_null() { " " } else { "x" };
    format!("[{mark}] {}  {:<12} P{:<2} {:<6} {}{}", short(&s(t, "id")), s(t, "status"), t["priority"], s(t, "band"), s(t, "title"), due)
}

fn run(link: &dyn Link, cmd: Cmd) -> R<()> {
    match cmd {
        Cmd::Project { cmd: ProjectCmd::Add { name, status } } => {
            let mut input = json!({"name": name});
            if !status.is_empty() {
                input["statuses"] = json!(status);
            }
            let p = link.call("projects.create", input, Some(&key()))?;
            println!("created project {} ({}): {}", s(&p, "name"), short(&s(&p, "id")), p["statuses"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect::<Vec<_>>().join(" > "));
        }
        Cmd::Project { cmd: ProjectCmd::List } => {
            for p in link.call("projects.list", json!({}), None)?.as_array().unwrap() {
                println!("{}  {:<20} {} tasks   {}", short(&s(p, "id")), s(p, "name"), p["task_count"], p["statuses"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect::<Vec<_>>().join(" > "));
            }
        }
        Cmd::Add { project, title, priority, due, desc } => {
            let p = project_of(link, &project)?;
            let mut input = json!({"project_id": p["id"], "title": title});
            if let Some(x) = priority { input["priority"] = json!(x); }
            if let Some(x) = due { input["due"] = json!(x); }
            if let Some(x) = desc { input["description"] = json!(x); }
            let t = link.call("tasks.create", input, Some(&key()))?;
            println!("{}", task_line(&t));
        }
        Cmd::List { project, status, query } => {
            let mut input = json!({"limit": 500});
            if let Some(p) = project { input["project_id"] = project_of(link, &p)?["id"].clone(); }
            if let Some(x) = status { input["status"] = json!(x); }
            if let Some(x) = query { input["q"] = json!(x); }
            let tasks = link.call("tasks.list", input, None)?;
            for t in tasks.as_array().unwrap() {
                println!("{}", task_line(t));
            }
            if tasks.as_array().unwrap().is_empty() {
                println!("(no tasks)");
            }
        }
        Cmd::Show { task } => {
            let t = task_of(link, &task)?;
            let id = t["id"].clone();
            println!("{}\n", task_line(&t));
            if !s(&t, "description").is_empty() {
                println!("{}\n", s(&t, "description"));
            }
            for f in link.call("followups.list", json!({"task_id": id}), None)?.as_array().unwrap() {
                println!("follow-up by {}: {}", s(f, "author"), s(f, "text"));
            }
            for c in link.call("comments.list", json!({"task_id": id}), None)?.as_array().unwrap() {
                let indent = if c["parent_id"].is_null() { "" } else { "    " };
                println!("{indent}{} ({}): {}", s(c, "author"), short(&s(c, "id")), s(c, "text"));
            }
        }
        Cmd::Move { task, status } => {
            let t = task_of(link, &task)?;
            let t = link.call("tasks.update", json!({"id": t["id"], "status": status}), Some(&key()))?;
            println!("{}", task_line(&t));
        }
        Cmd::Done { task } => {
            let t = task_of(link, &task)?;
            let p = link.call("projects.get", json!({"id": t["project_id"]}), None)?;
            let last = p["statuses"].as_array().unwrap().last().unwrap().clone();
            let t = link.call("tasks.update", json!({"id": t["id"], "status": last}), Some(&key()))?;
            println!("{}", task_line(&t));
        }
        Cmd::Edit { task, title, priority, due, clear_due, desc } => {
            let t = task_of(link, &task)?;
            let mut input = json!({"id": t["id"]});
            if let Some(x) = title { input["title"] = json!(x); }
            if let Some(x) = priority { input["priority"] = json!(x); }
            if let Some(x) = due { input["due"] = json!(x); }
            if clear_due { input["due"] = Value::Null; }
            if let Some(x) = desc { input["description"] = json!(x); }
            println!("{}", task_line(&link.call("tasks.update", input, Some(&key()))?));
        }
        Cmd::Rm { task } => {
            let t = task_of(link, &task)?;
            link.call("tasks.delete", json!({"id": t["id"]}), Some(&key()))?;
            println!("deleted {}", short(&s(&t, "id")));
        }
        Cmd::Comment { task, text, reply_to } => {
            let t = task_of(link, &task)?;
            let mut input = json!({"task_id": t["id"], "text": text});
            if let Some(r) = reply_to {
                let all = link.call("comments.list", json!({"task_id": t["id"]}), None)?;
                input["parent_id"] = pick(&all, "comment", &r, None)?["id"].clone();
            }
            let c = link.call("comments.add", input, Some(&key()))?;
            println!("commented ({})", short(&s(&c, "id")));
        }
        Cmd::Followup { task, text } => {
            let t = task_of(link, &task)?;
            link.call("followups.add", json!({"task_id": t["id"], "text": text}), Some(&key()))?;
            println!("follow-up added");
        }
        Cmd::Audit { task } => {
            let mut input = json!({"limit": 50});
            if let Some(t) = task {
                input["entity_id"] = task_of(link, &t)?["id"].clone();
            }
            for e in link.call("audit.list", input, None)?.as_array().unwrap() {
                println!("{}  {:<16} {} {}", e["ts"], s(e, "op"), s(e, "entity"), short(&s(e, "entity_id")));
            }
        }
        Cmd::Watch { after } => {
            let start = match after {
                Some(a) => a,
                None => link.describe()?["latest_seq"].as_u64().unwrap_or(0),
            };
            eprintln!("watching {} from event {start} (ctrl-c to stop)", link.endpoint());
            link.watch(start, &mut |e| {
                let what = e.data.get("task").map(|t| format!("{} [{}]", s(t, "title"), s(t, "status"))).unwrap_or_default();
                println!("#{} {} {}", e.seq, e.kind, what);
                true
            })?;
        }
        Cmd::Describe => {
            let d = link.describe()?;
            println!("contract {} · profile {} · via {}", d["contract"], d["profile"], link.endpoint());
            println!("ports: {}", d["ports"]);
            println!("plugins: {}", d["plugins"].as_array().unwrap().iter().map(|p| s(p, "id")).collect::<Vec<_>>().join(", "));
            for o in d["ops"].as_array().unwrap() {
                let allowed = match o.get("allowed") { Some(Value::Bool(false)) => " (not allowed for you)", _ => "" };
                println!("  {:<18} {:<8} {}{}", s(o, "name"), s(o, "kind"), s(o, "doc"), allowed);
            }
        }
    }
    Ok(())
}
