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
A plugin that fills a Port. (A plugin that fills an Extension point is a Provider, never an Adapter.)
_Avoid_: driver, backend

**Extension point**:
A slot that a plugin defines for other plugins to fill. It is owned by the plugin that defined it, not by the kernel.
_Avoid_: plugin port, hook point, socket

**Provider**:
A plugin that fills an Extension point.
_Avoid_: implementation, channel (for the plugin itself)

**Feature**:
A plugin that fills no Port and no Extension point: it adds Operations, Hooks, Listeners or data of its own, such as tasks, audit or quota.
_Avoid_: module, domain plugin, wrap plugin

**Theme**:
A plugin that only contributes data for Faces, such as colours, and runs no code.
_Avoid_: skin, style pack

**Manifest**:
What a plugin says about itself without running any code: what it needs, fills, adds and lets be set. Everything about a plugin's kind comes from its Manifest; no kind is declared.
_Avoid_: descriptor, config

**Runtime**:
How a plugin's code is run, and so how much it is trusted: native, data, and later wasm, js, remote.
_Avoid_: tier, engine, language

**Quality**:
The maturity level a plugin declares about itself: reference, bronze, silver.
_Avoid_: grade, tier, rating

### Choosing what runs

**Distribution**:
A named product: a Catalog of plugins together with the Profiles it ships. Starting a Core takes a Distribution set up with one Profile. Madar is a Distribution.
_Avoid_: edition, flavour, app (for the product as packaged plugins)

**Enabled / Active / Inactive**:
A plugin is Enabled when its Profile names it, and Active when it is running in the Core. Inactive means enabled but not running, always with a stated reason (not for this Profile, its Port went to another adapter, switched off while running). Its data stays.
_Avoid_: disabled (as a state), loaded, installed

**Settings**:
The part of a Profile that configures one plugin, checked against the schema in its Manifest.
_Avoid_: options, preferences (a Madar plugin's per-person choices)

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
Something a plugin is allowed to use, such as emitting events or calling other plugins. Asked for in its Manifest and granted by the operator in the Profile.
_Avoid_: permission (for what a plugin may use), privilege

**Owner**:
The plugin that owns something: a collection of data, an operation, an event kind. Only the owner may write its data or emit its events.
_Avoid_: author, maintainer; (a person who owns a record or a project is a Madar term, not this)

### Faces and the Link

**Face**:
Anything that talks to a Core through the Link: a web board, a command line, a generated console, an AI agent, another program. A Face is coupled when the Core runs inside its own process and decoupled when it reaches a Core over a network.
_Avoid_: client, frontend, UI (for the thing as a whole)

**Slot**:
A named place in a Face where plugins can add something, such as a toolbar button. The Face declares its Slots; an item in a Slot can only invoke an Operation.
_Avoid_: widget area, mount point

**Link**:
Everything a Core offers its Faces: Operations, self-description, and Pulse, independent of how they travel.
_Avoid_: API, protocol, contract (for the whole offer)

**Projection**:
One rendering of the Link over a particular transport: in-process calls, HTTP, MCP.
_Avoid_: binding, transport (for the rendering), adapter (reserved for Ports)

**Reason code**:
A name under a plugin's namespace that says why an Operation failed, such as tasks.stale_version, within one of the kernel's fixed error categories.
_Avoid_: error code, error type

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
The Event log as one Subject sees it: ordered, private to that Subject, and resumable from a cursor of its own. A cursor older than the log keeps is answered with a reset (reload). A Face follows Pulse.
_Avoid_: feed, notifications, websocket

### Extending behaviour and reacting to change

**Hook**:
Plugin code attached to an Operation. A before hook may change the input or refuse; an around hook wraps the Operation and may answer in its place; an after hook runs once it has succeeded. All of them run inside the Operation's transaction (a Query has none).
_Avoid_: wrap, interceptor, middleware, filter

**Event**:
A record that something happened, with an Event kind and an Audience, written to the Event log in the same transaction as the work that caused it. One record per change, however many people it concerns.
_Avoid_: message, notification, signal

**Event kind**:
The name of a type of Event, such as task.created. Declared by exactly one plugin, its Owner.
_Avoid_: event type, topic, channel

**Audience**:
Who an Event is addressed to: a Subject or a Scope. Only those it concerns may see it.
_Avoid_: recipient, subscriber, channel

**Scope**:
A group of Subjects declared by a plugin, such as the members of a project, resolved when Pulse is read so that someone removed from the group stops receiving its Events.
_Avoid_: room, channel, topic

**Event log**:
The stored, ordered sequence of all Events in a Core.
_Avoid_: stream, journal, queue

**Listener**:
Plugin code that reacts to Events inside a Core after they are committed. It keeps its own place in the Event log, runs at least once, and so must be safe to repeat. It cannot refuse or undo the work that caused the Event. A Face never is one.
_Avoid_: subscriber, handler, observer

### Checking before running

**Resolver**:
The part of the Kernel that reads Manifests and a Profile and reports every problem with it, without starting anything.
_Avoid_: validator, linker, loader
