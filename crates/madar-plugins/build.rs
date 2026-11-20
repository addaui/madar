// SPDX-License-Identifier: Apache-2.0
//! Records Madar's commit for `Product::about` (ADR 0100): from `MADAR_COMMIT` when the build gives it (the image build has no
//! `.git`), else from git, marked `+changes` when the working tree had changes; `unknown` when neither is there.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    println!("cargo:rerun-if-env-changed=MADAR_COMMIT");
    if let Some(dir) = git(&["rev-parse", "--git-dir"]) {
        println!("cargo:rerun-if-changed={dir}/HEAD");
        println!("cargo:rerun-if-changed={dir}/index");
    }
    let commit = std::env::var("MADAR_COMMIT").ok().filter(|c| !c.is_empty()).or_else(|| {
        let head = git(&["rev-parse", "HEAD"])?;
        let changed = git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty());
        Some(if changed { format!("{head}+changes") } else { head })
    });
    println!("cargo:rustc-env=MADAR_COMMIT={}", commit.unwrap_or_else(|| "unknown".into()));
}
