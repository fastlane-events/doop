# Scoped guidelines

Why: guidelines (named markdown docs agents read before designing) lived only on a canvas, so a
team's design system and its working rules for agents had to be copied onto every canvas, and an
agent connecting from its own client (Claude Desktop, Cursor, …) learned them only if it went
looking. Scoped guidelines put them on the workspace and on the whole install, and deliver the
working rules to every agent without any client-side setup.

## Model

- **Scopes**: `canvas` (the `guidelines` table, unchanged), `workspace` and `instance`
  (`scoped_guidelines`: `scope_type`, `scope_id` = the workspace id or `''` for the instance,
  `name`, `markdown`, `title`, `kind`; PK on the three keys). History in
  `scoped_guideline_versions`, same shape and 50-version cap as `guideline_versions`. Migration
  `0029_scoped_guidelines`.
- **Kind**: every doc is `style` (how frames look) or `instructions` (how agents work); new docs
  default to `style`, and an update that omits `kind` keeps it. The canvas table gained the column.
- **Effective docs** (`actions.effectiveGuidelines`): instance, then the canvas's workspace (if
  any), then the canvas, merged by name (`shared/types.ts` `mergeGuidelines`, shared with the
  client). A style doc: the nearest scope wins. An `instructions` doc at instance or workspace
  scope is an organisation rule and is never shadowed: a canvas write (REST, MCP, the resident,
  imports, accepted proposals — all through `actions.setGuideline`) using an inherited rule's name
  is refused, a workspace write using an instance rule's name is refused, and the merge keeps the
  rule even over a doc that predates it.
- **Who sees the workspace's docs**: only readers with durable access to the canvas (owner,
  invited members, workspace members — `hasDurableCanvasAccess`). A share-link visitor gets the
  instance's docs and the canvas's own, on every surface: REST `GET /api/canvases/:id`, the WS
  init, WS broadcasts (`durableOnly`), MCP `get_canvas` / `list_guidelines` / `get_guidelines`,
  the nudge and the resident prompt (judged for the run's requester). The instance's docs are
  visible to every account and agent on the install.
- Scoped docs live in the store next to the canvases (`store.getScopedGuidelines`), hydrated at
  boot; a deleted workspace drops its docs and history.

## Delivery

- `get_guide({ topic: "doop-instructions" })` appends "Your organisation's rules"
  (`guide.organisationRules`): the full markdown of every instance `instructions` doc, each headed
  with its name and scope — the instance's only. The initialize instructions say get_guide carries
  them, and name them (the MCP server is built per request, so the list is always current).
- A workspace's rules are delivered on its canvases only, never in get_guide: `get_canvas` appends
  them in full (`guide.workspaceRules`, "These apply on canvases of workspace …"), and so does the
  unread nudge the first time an agent writes on one of its canvases without having read them.
- A canvas's own `instructions` docs are notes from its editors, not the organisation's: listed
  with their kind, and in the resident prompt under "Notes left on this canvas by its editors"
  (`guide.canvasNotes`), below the organisation's rules.
- The resident prompt: style docs under "Canvas design guidelines", the instance's and the
  workspace's rules under "Your organisation's rules", the canvas's notes last.
- `get_canvas` / `list_guidelines` list effective docs with `scope` and `kind`; `get_guidelines`
  resolves by the merge order and says which scope served the doc. `list_canvases`'
  `guidelinesCount` counts the canvas's own docs.
- **The unread nudge** tracks read docs per agent (MCP: connected account + agent_name) by doc:
  an inherited doc read on one canvas is read on its siblings, a canvas doc per canvas. Listing or
  reading any doc marks every current doc read; a doc that appears later is unread. Instance
  rules are left out (get_guide delivered them); workspace rules come in full and count as read
  once delivered; style docs and canvas notes are named, in separate sentences.

## Writing

| scope     | REST                                                  | MCP `set_guidelines` | CLI                                  | who                                |
| --------- | ----------------------------------------------------- | -------------------- | ------------------------------------ | ---------------------------------- |
| canvas    | `PUT /api/canvases/:id/guidelines/:name`              | yes (the only scope) | —                                    | anyone with canvas access          |
| workspace | `PUT /api/workspaces/:id/guidelines/:name`            | refused              | `--scope workspace --workspace <id>` | workspace admin or owner; operator |
| instance  | `PUT /api/admin/guidelines/:name` (404 to non-admins) | refused              | `--scope instance`                   | instance admin; operator           |

Agents never write above their canvas: a prompt-injected session holding an admin's OAuth token
or agent key could otherwise plant instructions in every agent on the install. MCP refuses
`scope: "workspace" | "instance"` with a message pointing at the settings UI; the resident's
tool has no scope at all.

Empty markdown deletes. `GET …/guidelines` lists (workspace members; instance admins) and
`GET …/guidelines/:name/history` returns versions.

**Operator CLI** (`scripts/set-guideline.ts`, also in the server image): seeds a workspace or
instance doc from a file kept in git —
`npx tsx scripts/set-guideline.ts --scope instance|workspace [--workspace <id>] --name <slug> [--kind style|instructions] [--title <t>] (--file <path> | --delete)`.
It writes through `actions.setScopedGuideline` (same validation and no-shadowing rule; versions
saved by "cli") against `DATABASE_URL`, or the local PGlite (stop the server first: one process at
a time), and waits for its writes (`persist.drain`). There is no cross-process signal, so a
running server picks the change up on its next restart.

## UI and realtime

A write broadcasts the existing `{ type: 'guidelines' }` event, now with `scope` set, to every
canvas below that scope (a workspace's only to viewers with durable access); canvases are served
with `inheritedGuidelines`. The Memory panel lists inherited docs read-only with a Workspace /
Instance badge (a canvas style doc of the same name hides an inherited style doc; rules always
show). Workspace settings has a Rules pane (admins edit, members read; "visible to members of
this workspace"); the admin page has a Rules tab ("visible to every account and agent on this
install").

## Known gaps

- Writes are fire-and-forget like the canvas docs': the store answers before the database row
  lands, so a crash in between loses the write.
- Moving a canvas between workspaces does not push the new inherited set to open viewers; they
  see it on reload.
- The distiller proposes into canvas docs only.
