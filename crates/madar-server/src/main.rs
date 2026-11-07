//! `madar-server`: Madar on the Nuah host. See `nuah-host` for the commands.
fn main() {
    nuah_host::run(madar_server::Madar)
}
