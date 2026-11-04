use clap::Parser;
use std::path::PathBuf;

/// The Nu'ah server: the Madar distribution behind the HTTP projection of the Link.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Profile file (JSON). Without one, runs the embedded profile on --db.
    #[arg(long)]
    profile: Option<PathBuf>,
    /// SQLite file used when no profile is given.
    #[arg(long, default_value = "madar.db")]
    db: String,
    #[arg(long, default_value = "127.0.0.1:8787")]
    listen: String,
    /// Directory of the web face to host at /faces/web.
    #[arg(long)]
    web: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let dist = match &args.profile {
        Some(p) => {
            let text = std::fs::read_to_string(p).unwrap_or_else(|e| fatal(&format!("cannot read {}: {e}", p.display())));
            nuah_madar::from_profile_json(&text).unwrap_or_else(|e| fatal(&e))
        }
        None => nuah_madar::embedded(&args.db, "Me"),
    };
    let profile_name = dist.name.clone();
    let core = nuah_madar::start(dist).unwrap_or_else(|e| fatal(&e));
    let app = nuah_server::router(core, args.web);
    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap_or_else(|e| fatal(&format!("cannot listen on {}: {e}", args.listen)));
    eprintln!("nuah-server: profile `{profile_name}` listening on http://{}", args.listen);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap_or_else(|e| fatal(&e.to_string()));
}

fn fatal(msg: &str) -> ! {
    eprintln!("nuah-server: {msg}");
    std::process::exit(1)
}
