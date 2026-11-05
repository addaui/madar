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
    /// Directory of the generated console face to host at /faces/console.
    #[arg(long)]
    console: Option<PathBuf>,
    /// Extra Host names to answer to (repeatable), for example a LAN address. Loopback names are always allowed.
    #[arg(long = "allow-host")]
    allow_host: Vec<String>,
    /// Run the setup wizard instead of the app: choose plugins and settings and save the profile
    /// file given by --profile. Loopback addresses only; no data is opened.
    #[arg(long)]
    setup: bool,
    /// Directory of the setup face to host at /faces/setup (with --setup).
    #[arg(long = "setup-face")]
    setup_face: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    if args.setup {
        return run_setup(args).await;
    }
    let dist = match &args.profile {
        Some(p) => {
            let text = std::fs::read_to_string(p).unwrap_or_else(|e| fatal(&format!("cannot read {}: {e}", p.display())));
            nuah_madar::from_profile_json(&text).unwrap_or_else(|e| fatal(&e))
        }
        None => nuah_madar::embedded(&args.db, "Me"),
    };
    let profile_name = dist.name.clone();
    let core = nuah_madar::start(dist).unwrap_or_else(|e| fatal(&e));
    let mut hosts = nuah_server::default_hosts();
    if let Some((h, _)) = args.listen.rsplit_once(':') {
        if h != "0.0.0.0" && h != "[::]" {
            hosts.push(h.to_lowercase());
        }
    }
    hosts.extend(args.allow_host.iter().map(|h| h.to_lowercase()));
    let app = nuah_server::router_full(core, args.web, args.console, hosts);
    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap_or_else(|e| fatal(&format!("cannot listen on {}: {e}", args.listen)));
    eprintln!("nuah-server: profile `{profile_name}` listening on http://{}", args.listen);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            eprintln!("nuah-server: shutting down");
            // Pulse streams never end on their own, so do not wait for them forever.
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                std::process::exit(0);
            });
        })
        .await
        .unwrap_or_else(|e| fatal(&e.to_string()));
}

fn fatal(msg: &str) -> ! {
    eprintln!("nuah-server: {msg}");
    std::process::exit(1)
}

async fn run_setup(args: Args) {
    let host = args.listen.rsplit_once(':').map(|(h, _)| h).unwrap_or("");
    if !["127.0.0.1", "localhost", "[::1]"].contains(&host) {
        fatal("setup mode writes files, so it only listens on a loopback address (127.0.0.1, localhost or [::1])");
    }
    let Some(path) = args.profile.clone() else { fatal("--setup needs --profile <file> to read and save") };
    let setup = nuah_server::setup::Setup {
        catalog: nuah_madar::catalog(),
        path,
        starting_point: nuah_madar::embedded(&args.db, "Me"),
    };
    let app = nuah_server::setup::setup_router(setup, args.setup_face, nuah_server::default_hosts());
    let listener = tokio::net::TcpListener::bind(&args.listen).await.unwrap_or_else(|e| fatal(&format!("cannot listen on {}: {e}", args.listen)));
    eprintln!("nuah-server: setup wizard on http://{}  (nothing is started; Ctrl-C to stop)", args.listen);
    axum::serve(listener, app).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await.unwrap_or_else(|e| fatal(&e.to_string()));
}
