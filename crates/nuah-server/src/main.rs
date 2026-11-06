//! `nuah-server`: run Madar over HTTP.
//!
//!   nuah-server hash-password            read a password on stdin, print its stored form
//!   nuah-server serve --db madar.db --accounts accounts.json [--listen 127.0.0.1:3000]
//!   nuah-server serve --profile profile.json                 run a Profile the wizard saved
//!   nuah-server setup --profile profile.json --face faces/setup   choose plugins and settings
//!
//! `accounts.json` is `[{"name": "...", "password_hash": "...", "roles": ["member"]}]` and lives
//! outside the repository: it is the operator's secret, never part of a Profile in git.

use clap::{Parser, Subcommand};
use nuah_adapters::AuthPassword;
use nuah_kernel::Core;
use std::io::Read;

#[derive(Parser)]
#[command(name = "nuah-server")]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    HashPassword,
    /// Choose plugins and settings in a browser and save a Profile (loopback only; ADR 0014).
    Setup {
        /// The Profile file to edit (created if missing).
        #[arg(long)]
        profile: std::path::PathBuf,
        #[arg(long, default_value = "127.0.0.1:3100")]
        listen: String,
        /// Directory of the wizard (hosted at /faces/setup).
        #[arg(long)]
        face: Option<std::path::PathBuf>,
    },
    Serve {
        /// Run a Profile file (what the wizard saves) instead of --db and --accounts.
        #[arg(long, conflicts_with_all = ["db", "accounts"])]
        profile: Option<std::path::PathBuf>,
        #[arg(long, requires = "accounts")]
        db: Option<String>,
        #[arg(long, requires = "db")]
        accounts: Option<String>,
        #[arg(long, default_value = "127.0.0.1:3000")]
        listen: String,
        /// Extra Host names to answer to (behind a reverse proxy).
        #[arg(long = "allow-host")]
        allow_host: Vec<String>,
        /// The proxy terminates TLS: mark the session cookie Secure.
        #[arg(long)]
        secure_cookie: bool,
        /// Directory of the web board (hosted at /faces/web).
        #[arg(long)]
        web: Option<std::path::PathBuf>,
        /// Directory of the generated console (hosted at /faces/console).
        #[arg(long)]
        console: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() {
    match Args::parse().cmd {
        Cmd::HashPassword => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).expect("read stdin");
            println!("{}", AuthPassword::hash_password(s.trim_end_matches(['\r', '\n'])));
        }
        Cmd::Setup { profile, listen, face } => {
            let addr: std::net::SocketAddr = listen.parse().unwrap_or_else(|_| die(&format!("{listen} is not an address like 127.0.0.1:3100")));
            if !addr.ip().is_loopback() {
                die("setup listens on loopback only (127.0.0.1 or [::1])");
            }
            let code = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
            let mut server = nuah_server::Config::default();
            server.faces.extend(face.map(|d| ("/faces/setup".to_string(), d)));
            let cfg = nuah_server::setup::SetupConfig {
                distribution: "madar".into(),
                catalog: nuah_madar::catalog(),
                starting_point: nuah_madar::profile_embedded("madar.db"),
                profile_path: profile,
                code: code.clone(),
                server,
            };
            let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| die(&format!("cannot listen on {listen}: {e}")));
            eprintln!("nuah setup on http://{listen}/\nsetup code: {code}   (type it into the wizard; it changes every start)");
            axum::serve(listener, nuah_server::setup::setup_router(cfg)).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await.expect("serve");
        }
        Cmd::Serve { profile, db, accounts, listen, allow_host, secure_cookie, web, console } => {
            let dist = match (profile, db, accounts) {
                (Some(path), _, _) => {
                    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| die(&format!("cannot read {}: {e}", path.display())));
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| die(&format!("{} is not JSON: {e}", path.display())));
                    nuah_madar::distribution(nuah_kernel::setup::profile_from_json(&v).unwrap_or_else(|e| die(&e)))
                }
                (None, Some(db), Some(accounts)) => {
                    let accounts: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&accounts).unwrap_or_else(|e| die(&format!("cannot read {accounts}: {e}"))))
                        .unwrap_or_else(|e| die(&format!("{accounts} is not JSON: {e}")));
                    nuah_madar::distribution(nuah_madar::profile_server(&db, accounts))
                }
                _ => die("give --profile FILE, or both --db and --accounts"),
            };
            if dist.profile.enabled.iter().any(|p| p == "auth-local") && !listen.parse::<std::net::SocketAddr>().is_ok_and(|a| a.ip().is_loopback()) {
                die("the profile uses auth-local (everyone is admin); listen on 127.0.0.1 or use auth-password");
            }
            let core = Core::start(&dist).unwrap_or_else(|problems| {
                for p in &problems {
                    eprintln!("{}: {}", p.code, p.message);
                }
                die("the profile does not resolve")
            });
            let mut cfg = nuah_server::Config { secure_cookie, ..Default::default() };
            cfg.faces.extend(web.map(|d| ("/faces/web".to_string(), d)));
            cfg.faces.extend(console.map(|d| ("/faces/console".to_string(), d)));
            cfg.hosts.extend(allow_host.iter().map(|h| h.to_lowercase()));
            let listener = tokio::net::TcpListener::bind(&listen).await.unwrap_or_else(|e| die(&format!("cannot listen on {listen}: {e}")));
            eprintln!("nuah-server on http://{listen} (contract {})", core.contract_hash());
            nuah_server::spawn_background(core.clone());
            axum::serve(listener, nuah_server::router(core, cfg)).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await.expect("serve");
        }
    }
}

fn die(msg: &str) -> ! {
    eprintln!("nuah-server: {msg}");
    std::process::exit(1)
}
