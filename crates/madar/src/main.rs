// SPDX-License-Identifier: Apache-2.0
//! `madar`: Madar on the Nuah shell. See `nuah-shell` for the commands.
fn main() {
    nuah_shell::run(madar_plugins::Madar)
}
