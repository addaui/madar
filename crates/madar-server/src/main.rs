//! `madar-server`: Madar on the Nu'ah host. See `nuah-host` for the commands.
fn main() {
    nuah_host::run(madar_server::Madar)
}
