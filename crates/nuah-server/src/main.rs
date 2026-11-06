//! `nuah-server`: run Madar over HTTP.
//!
//!   nuah-server hash-password            read a password on stdin, print its stored form
//!   nuah-server serve --db madar.db --accounts accounts.json [--listen 127.0.0.1:3000]
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
    Serve {
        #[arg(long)]
        db: String,
        #[arg(long)]
        accounts: String,
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
        Cmd::Serve { db, accounts, listen, allow_host, secure_cookie, web, console } => {
            let accounts: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&accounts).unwrap_or_else(|e| die(&format!("cannot read {accounts}: {e}"))))
                .unwrap_or_else(|e| die(&format!("{accounts} is not JSON: {e}")));
            let dist = nuah_madar::distribution(nuah_madar::profile_server(&db, accounts));
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
