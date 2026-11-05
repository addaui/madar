# Madar

A task manager: people keep tasks in projects, share projects with others, and follow changes live. It is a Distribution of Nu'ah.

## Language

**Project**:
A named board of Tasks with its own list of statuses, shared by its Members.
_Avoid_: board, workspace, list

**Task**:
A unit of work in a Project, with a status, priority, optional due date and assignee.
_Avoid_: card, item, ticket

**Member**:
A Subject who has access to a Project, with an Access level.
_Avoid_: collaborator, participant

**Access level**:
What a Member may do in one Project: owner, editor or viewer. Not related to a Nu'ah Role.
_Avoid_: role, permission

**Project owner**:
The Member with the owner Access level: the one who may change the Project and share it. Not the Nu'ah Owner (a plugin).
_Avoid_: admin, creator
