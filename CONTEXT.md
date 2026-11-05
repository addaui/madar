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

**Subject**:
The stable id of whoever acts: a person or an agent.
_Avoid_: user, account, principal

**Identity**:
Who is making a request, as verified by the auth adapter: a Subject, a display name and Roles.
_Avoid_: caller, user, session

**Role**:
A name an Identity carries, instance-wide. The policy turns Roles into Permissions.
_Avoid_: group, level (per-project access is an Access level, a Madar term)

**Permission**:
Something a Subject is allowed to do, such as writing tasks. Granted by the policy.
_Avoid_: right, privilege, scope

**Capability**:
Something a plugin is allowed to use, such as emitting events or calling other plugins. Granted to the plugin by the operator through its manifest.
_Avoid_: permission (for what a plugin may use), privilege

**Owner**:
The plugin that owns something: a collection of data, an operation, an event kind. Only the owner may write its data or emit its events.
_Avoid_: author, maintainer; (a person who owns a record or a project is a Madar term, not this)

### Faces and the Link

**Face**:
Anything that talks to a Core through the Link: a web board, a command line, a generated console, an AI agent, another program. A Face is coupled when the Core runs inside its own process and decoupled when it reaches a Core over a network.
_Avoid_: client, frontend, UI (for the thing as a whole)

**Slot**:
A named place in a Face where plugins can add something, such as a toolbar button.
_Avoid_: widget area, mount point

**Link**:
Everything a Core offers its Faces: Operations, self-description, and Pulse, independent of how they travel.
_Avoid_: API, protocol, contract (for the whole offer)

**Projection**:
One rendering of the Link over a particular transport: in-process calls, HTTP, MCP.
_Avoid_: binding, transport (for the rendering), adapter (reserved for Ports)

**Operation**:
A named, schema-checked thing a Face can ask a Core to do or read. Every Operation is a Command or a Query.
_Avoid_: endpoint, action, method, call (the act of invoking one)

**Command**:
An Operation that may change data. Safe to retry when given an idempotency key.
_Avoid_: mutation, write

**Query**:
An Operation that only reads.
_Avoid_: read, getter

**Pulse**:
The ordered stream of events a Face can follow, private to each person and resumable from any point. (Provisional: its relation to events is settled with the hooks-and-events terms.)
_Avoid_: feed, notifications, websocket
