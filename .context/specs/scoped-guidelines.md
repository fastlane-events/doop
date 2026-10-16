# Scoped guidelines

Why: guidelines (named markdown docs agents read before designing) lived only on a canvas, so a
team's design system and its working rules for agents had to be copied onto every canvas, and an
agent connecting from its own client (Claude Desktop, Cursor, …) learned them only if it went
looking. Scoped guidelines put them on the workspace and on the whole install, and deliver the
working rules to every agent with the guide it must read first.

## Model

- **Scopes**: `canvas` (the `guidelines` table, unchanged), `workspace` and `instance`
  (`scoped_guidelines`: `scope_type`, `scope_id` = the workspace id or `''` for the instance,
  `name`, `markdown`, `title`, `kind`; PK on the three keys). History in
  `scoped_guideline_versions`, same shape and 50-version cap as `guideline_versions`. Migration
  `0029_scoped_guidelines`.
- **Kind**: every doc is `style` (how frames look) or `instructions` (how agents work); new docs
  default to `style`, and an update that omits `kind` keeps it. The canvas table gained the column.
- **Effective docs** (`actions.effectiveGuidelines`): instance, then the canvas's workspace (if
  any), then the canvas, merged by name, nearest scope winning (`shared/types.ts`
  `mergeGuidelines`, shared with the client). A personal canvas gets instance + canvas.
- Scoped docs live in the store next to the canvases (`store.getScopedGuidelines`), hydrated at
  boot; a deleted workspace drops its docs and history.

## Delivery

- `get_guide({ topic: "doop-instructions" })` appends "Your organisation's rules"
  (`guide.organisationRules`): the full markdown of every `instructions` doc at instance scope and
  in every workspace the connected user belongs to, each headed with its name and scope. The
  initialize instructions say get_guide carries them, and name the instance's `instructions` docs
  (the MCP server is built per request, so the list is always current).
- The resident agents get the same section in their system prompt, built from the canvas's
  effective `instructions` docs; its `style` docs stay under "Canvas design guidelines".
- `get_canvas` / `list_guidelines` list effective docs with `scope` and `kind`; `get_guidelines`
  resolves by the merge order and says which scope served the doc. The unread nudge tracks seen
  docs per canvas + agent by scope and name: listing or reading marks every current doc seen; a
  doc that appears later (a new workspace rule, the canvas moving into a workspace) is unread.

## Writing

| scope     | REST                                                  | MCP `set_guidelines`     | who                                |
| --------- | ----------------------------------------------------- | ------------------------ | ---------------------------------- |
| canvas    | `PUT /api/canvases/:id/guidelines/:name`              | `scope` omitted/`canvas` | anyone with canvas access          |
| workspace | `PUT /api/workspaces/:id/guidelines/:name`            | `scope: "workspace"`     | workspace admin or owner           |
| instance  | `PUT /api/admin/guidelines/:name` (404 to non-admins) | `scope: "instance"`      | instance admin (`user.role` admin) |

Empty markdown deletes. `GET …/guidelines` lists (workspace members; instance admins) and
`GET …/guidelines/:name/history` returns versions. MCP checks the connected user, not the agent:
workspace role via `workspaces.hasRole`, instance admin via `auth.isAdminUser` (uncached, so a
demotion bites at once). Instance admin over MCP grants only this write; it does not widen
`canAccessCanvas` — the admin still needs a canvas they can open to call the tool from.

## UI and realtime

A write broadcasts the existing `{ type: 'guidelines' }` event, now with `scope` set, to every
canvas below that scope; canvases are served with `inheritedGuidelines`. The Memory panel lists
inherited docs read-only with a Workspace / Instance badge (a canvas doc of the same name hides
them). Workspace settings has a Rules pane (admins edit, members read); the admin page has a Rules
tab. Gap: moving a canvas between workspaces does not push the new inherited set to open viewers;
they see it on reload.
