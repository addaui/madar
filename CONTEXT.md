# Nu'ah

A plugin-first core framework: a small kernel that runs plugins, so that apps (distributions) are made by choosing and configuring plugins, and so that the faces people use stay separate from the core they talk to.

## Language

### The machine

**Kernel**:
The plugin-agnostic machinery: it reads plugins, resolves what is needed, and runs everything else. It knows nothing about any app.
_Avoid_: engine, runtime, framework (for the machinery)

**Core**:
One running instance: the kernel together with its active plugins and the adapters bound to its ports. Faces talk to a Core.
_Avoid_: server, backend, instance

### Plugins and what they fill

**Plugin**:
A unit of behaviour added to a Core and described by a manifest, switched on or off as a whole.

**Catalog**:
Every plugin available to be switched on, before any choice has been made.
_Avoid_: registry, store

**Port**:
One of the kernel's fixed infrastructure slots (storage, sign-in, authorization, clock, ids). Exactly one adapter fills each Port in a Core.
_Avoid_: interface, service (for a Port)

**Adapter**:
A plugin that fills a Port.
_Avoid_: driver, backend

**Extension point**:
A slot that a plugin defines for other plugins to fill. It is owned by the plugin that defined it, not by the kernel.
_Avoid_: plugin port, hook point, socket

**Provider**:
A plugin that fills an Extension point.
_Avoid_: implementation, channel (for the plugin itself)

### Choosing what runs

**Distribution**:
A named product: a Catalog of plugins together with the Profiles it ships. Madar is a Distribution.
_Avoid_: edition, flavour, app (for the product as packaged plugins)

**Profile**:
One set of choices for a Distribution: which plugins are on, which adapter fills each Port, and the settings of each plugin. Starting a Core takes a Profile.
_Avoid_: config, preset, distribution (for a single set of choices)

### Who may do what

**Permission**:
Something a caller is allowed to do, such as writing tasks. Granted by the policy.
_Avoid_: right, privilege, scope

**Capability**:
Something a plugin is allowed to use, such as emitting events or calling other plugins. Granted to the plugin by the operator through its manifest.
_Avoid_: permission (for what a plugin may use), privilege
