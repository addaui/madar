# Context Map

## Contexts

- [Nu'ah](./CONTEXT.md) — the plugin-first framework: kernel, plugins, ports, faces, the Link
- [Madar](./crates/nuah-madar/CONTEXT.md) — the task-manager Distribution built on Nu'ah, and its own domain words

## Relationships

- **Madar → Nu'ah**: Madar is a Distribution: it uses Nu'ah's terms (Plugin, Profile, Face, Operation) and adds domain words of its own. Nu'ah never uses Madar's words.
- **Role (Nu'ah) vs Access level (Madar)**: a Role is instance-wide and carried by an Identity; an Access level is what a Subject has in one Project. They are unrelated, and Madar's per-project "owner" is never the instance's top Role.
