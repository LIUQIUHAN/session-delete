# Session delete

`@ly14081622/session-delete` adds a **Delete session** action to the Web sidebar's Session menu and the Host route behind it. Session persistence deliberately ships no deletion API — the JSONL backend documents that "nothing deletes session files" — so this bundle owns that operation end to end.

## Use this package

1. Right-click a session row, or open the row's **More** (…) menu.
2. Choose **Delete session**.
3. Confirm in the dialog.

Every session can be deleted, including the one this window has open and the one whose turn is running. The confirmation says what will happen: a running session is stopped first (its current turn, background jobs, and subagents), and deleting the open session moves the view to a new session.

## What happens to an open or running session

The Host tears the session down before touching its files, so the log is closed and its last events are durable:

1. **Archive admission** stops the session the way the user's own **stop and archive** does — running turn, background jobs, running subagents, and scheduled reminders — and keeps it from waking again while the files are removed.
2. The Agent's own ordered teardown (owned by the Session Controller for a GUI session) drains the loop, closes the persistence write handle, and only then leaves the registry. The request waits for that teardown to settle.
3. The archive mark this request wrote is cleared again.
4. The log generations are removed, then the now-empty session directory.

Queued but unsent messages are discarded with the session, as they would be by a delete. If any of these steps fails, nothing is deleted, the archive mark is cleared, and the dialog reports the reason.

## What is deleted

- every canonical generation file (`session.jsonl`, `session.v1.jsonl.zstd`, …) in the session-owned directory;
- the directory itself, only when nothing else remains in it (a leftover file makes the directory stay, which is the intended safety outcome).

The session list refreshes afterwards; the full-text search index reconciles deleted sources on its next search.

## What is not deleted

- **Attachments** are content-addressed and may be shared with other sessions, so they stay in the attachment store.
- **Projection-cache checkpoints** under the DSH home are left behind; the cache serves values only for sessions the persistence backend still lists. Pruning them is out-of-band maintenance, as persistence itself documents.
- **Sub-session logs** live in their own directories and are not removed with the parent; a child session is refused with `session/subagent` because its work belongs to the parent that drives it.

## Limitations

- **A stuck session cannot be deleted.** If the running turn does not stop or the log does not close within about 20 seconds, the dialog reports it (`session/stop-failed`, `session/detach-failed`); restart DSH and delete it again.
- **Another DSH process is not coordinated.** The teardown happens in this process; a second instance writing the same session is not visible here. Close other instances before deleting sessions they may have open.
- **Sessions that were never written to disk** report `session/unmaterialized`; there is no file to remove.
- **No bulk delete.** The menu acts on one session at a time; the Host route accepts up to 100 ids per request for future callers.
- **Desktop and Web only.** The action lives in the Web sidebar; there is no agent tool for deletion, because it is destructive and deliberately user-only.

## Host API

`POST /api/session.delete` (authenticated exact route; owner Peer only), body `{ "sessionIds": ["…"] }`, answer:

```json
{ "ok": true, "deleted": ["…"], "stopped": ["…"], "failed": [{ "id": "…", "code": "session/stop-failed", "message": "…" }] }
```

`stopped` lists the ids that were loaded in this process and torn down before removal. Failure codes: `session/subagent`, `session/stop-failed`, `session/detach-failed`, `session/not-found`, `session/unmaterialized`, `session/unsafe-path`, `session/delete-failed`.

## Composition

The bundle patch inserts one Host row, `session-delete`, which requires `connection`, `sessions`, `agents`, and `sessionPersistence` and uses `workspaceRegistry` when the Web bundle composes it. The browser half is discovered from `dsh.client` and registers into `shell.overlay`, `contextMenu.icon`, and the shared Session context menu.
