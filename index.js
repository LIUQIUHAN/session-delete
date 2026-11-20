/**
 * Host half of the session-delete bundle.
 *
 * Exposes one authenticated POST route, `api/session.delete`, that removes a
 * stored Session's log from disk. Session persistence has no deletion API (its
 * backend documents "nothing deletes session files"), so this plugin owns the
 * filesystem operation and its safety checks:
 *
 *  - a Session still loaded in this process is stopped and torn down first,
 *    through the seams that already model the user's own stop and archive
 *    actions (Agent cancel + quiescence, background jobs, subagent
 *    descendants, archive admission), so its persistence write handle closes
 *    and its final events reach storage before the file is removed;
 *  - only files named like a canonical JSONL session log are removed, so a
 *    surprising `location.path` can never widen the deletion;
 *  - the session-owned directory is removed only with `rmdir`, which fails
 *    when anything else is inside it.
 */

import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Loader row name; also the module id the bundle patch inserts. */
export const name = 'session-delete'

/** Services this Host half needs; without them the plugin stays inactive. */
export const inject = ['connection', 'sessions', 'sessionPersistence', 'agents']

/** Canonical JSONL generation filenames written by dsh-session-persistence-jsonl. */
const LOG_FILE = /^session(?:\.v[0-9]+)?\.jsonl(?:\.zstd)?$/

/** Absolute registration path; the browser addresses `api/session.delete`. */
const DELETE_PATH = '/api/session.delete'

/** Upper bound per request; the sidebar deletes one Session at a time. */
const MAX_IDS = 100

/** How long a cancelled turn may take to reach quiescence before the removal is refused. */
const STOP_TIMEOUT_MS = 20_000

/** How long the registries may take to drop a torn-down Session. */
const DETACH_TIMEOUT_MS = 10_000

/** How long the persistence handle may take to close after teardown. */
const UNLOCK_TIMEOUT_MS = 5_000

/**
 * Register the delete route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context with Connection, sessions, agents, and persistence.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleRequest(ctx, request),
  }), 'session-delete: delete route')
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {Request} request - buffered POST request.
 * @returns {Promise<Response>} per-id outcome; HTTP 200 whenever the request itself was valid.
 */
async function handleRequest(ctx, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json(400, {
      ok: false,
      error: { code: 'request/invalid-json', message: 'The request body must be JSON.' },
    })
  }
  const ids = body?.sessionIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS
    || ids.some(id => typeof id !== 'string' || id.length === 0 || id.length > 200)) {
    return json(400, {
      ok: false,
      error: {
        code: 'request/invalid-session-ids',
        message: `sessionIds must be a non-empty array of at most ${MAX_IDS} Session ids.`,
      },
    })
  }
  const deleted = []
  const stopped = []
  const failed = []
  for (const id of ids) {
    let outcome
    try {
      outcome = await deleteOne(ctx, id)
    } catch (error) {
      outcome = { ok: false, code: 'session/delete-failed', message: messageOf(error) }
    }
    if (outcome.ok) {
      deleted.push(id)
      if (outcome.stopped === true) stopped.push(id)
    } else {
      failed.push({ id, code: outcome.code, message: outcome.message })
    }
  }
  return json(200, { ok: true, deleted, stopped, failed })
}

/**
 * Remove one stored Session, tearing it down first when this process has it loaded.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} id - Session identity.
 * @returns {Promise<{ ok: true, stopped: boolean } | { ok: false, code: string, message: string }>} outcome.
 */
async function deleteOne(ctx, id) {
  let stopped = false
  if (ctx.sessions.get(id) !== undefined || ctx.agents.get(id) !== undefined) {
    const detached = await detach(ctx, id)
    if (detached !== true) return detached
    stopped = true
  }

  let snapshot
  try {
    snapshot = await ctx.sessionPersistence.stat(id)
  } catch (error) {
    return { ok: false, code: 'session/not-found', message: messageOf(error) }
  }

  const path = snapshot?.location?.path
  if (typeof path !== 'string' || path === '') {
    return {
      ok: false,
      code: 'session/unmaterialized',
      message: 'The Session has no stored log file (it was created but never written).',
    }
  }

  const file = basename(path)
  if (!LOG_FILE.test(file)) {
    return {
      ok: false,
      code: 'session/unsafe-path',
      message: `Refused to delete ${path}: it is not a canonical Session log file.`,
    }
  }

  try {
    const info = await lstat(path)
    if (!info.isFile()) {
      return { ok: false, code: 'session/unsafe-path', message: `Refused to delete ${path}: not a regular file.` }
    }
  } catch (error) {
    return { ok: false, code: 'session/not-found', message: messageOf(error) }
  }

  const directory = dirname(path)
  try {
    await removeWhenUnlocked(ctx, id, path)
    for (const entry of await readdir(directory)) {
      if (LOG_FILE.test(entry)) await rm(join(directory, entry), { force: true })
    }
  } catch (error) {
    return { ok: false, code: 'session/delete-failed', message: messageOf(error) }
  }

  // The Session owns this directory, but never remove anything it does not own:
  // rmdir fails on any leftover file (a stale lock, a hand-placed note) and that
  // failure is the intended outcome rather than an error worth reporting.
  try {
    await rmdir(directory)
  } catch (error) {
    const code = error?.code
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'EPERM' && code !== 'EBUSY') {
      return { ok: false, code: 'session/delete-failed', message: messageOf(error) }
    }
  }
  return { ok: true, stopped }
}

/**
 * Stop and tear down a Session this process has loaded, so its log is closed and removable.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} id - Session identity.
 * @returns {Promise<true | { ok: false, code: string, message: string }>} `true` once detached.
 */
async function detach(ctx, id) {
  const agent = ctx.agents.get(id)
  if (agent !== undefined && agent.session.header.origin === 'subagent') {
    return {
      ok: false,
      code: 'session/subagent',
      message: 'This is a subagent Session; delete the Session that runs it instead.',
    }
  }

  const workspace = ctx.get('workspaceRegistry')
  if (workspace?.archiveSession === undefined) return stopBareAgent(ctx, id, agent)
  // Archive admission stops the running turn, background jobs, subagent
  // descendants, and scheduled reminders exactly as the user's own "stop and
  // archive" does, and keeps the Session from waking again while the log is
  // being removed. Archive's own stop discards queued input (`keepInbox`
  // unset), which matches deleting the Session.
  try {
    await workspace.archiveSession(id, { stopActivity: true })
  } catch (error) {
    return {
      ok: false,
      code: 'session/stop-failed',
      message: `The running work could not be stopped: ${messageOf(error)}`,
    }
  }
  // Whatever this request archived must be unarchived again if the log is not
  // removed: a surviving mark hides the Session everywhere and would keep a
  // later same-id Session from ever running a step.
  let outcome
  try {
    outcome = await detachRegistries(ctx, id)
  } catch (error) {
    outcome = { ok: false, code: 'session/detach-failed', message: messageOf(error) }
  }
  return withRestored(ctx, workspace, id, outcome)
}

/**
 * Without the Workspace bundle this plugin owns the stop itself: drop queued
 * input and abort the active turn, wait for quiescence, then tear down.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} id - Session identity.
 * @param {object | undefined} agent - the Agent driving it, if any.
 * @returns {Promise<true | { ok: false, code: string, message: string }>} `true` once detached.
 */
async function stopBareAgent(ctx, id, agent) {
  if (agent === undefined) return detachRegistries(ctx, id)
  try {
    agent.cancel?.({ kind: 'user' })
  } catch (error) {
    return {
      ok: false,
      code: 'session/stop-failed',
      message: `The running turn could not be stopped: ${messageOf(error)}`,
    }
  }
  try {
    await withTimeout(agent.whenIdle?.(), STOP_TIMEOUT_MS)
  } catch (error) {
    return {
      ok: false,
      code: 'session/stop-failed',
      message: `The running turn has not stopped: ${messageOf(error)}`,
    }
  }
  return detachRegistries(ctx, id)
}

/**
 * Clear the archive mark this request wrote, then report the teardown outcome.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {object | undefined} workspace - Workspace registry, when composed.
 * @param {string} id - Session identity.
 * @param {true | { ok: false, code: string, message: string }} outcome - teardown result.
 * @returns {Promise<true | { ok: false, code: string, message: string }>} `true` once detached and restored.
 */
async function withRestored(ctx, workspace, id, outcome) {
  if (workspace?.unarchiveSession === undefined) return outcome
  try {
    await workspace.unarchiveSession(id)
    return outcome
  } catch {
    try {
      await workspace.unarchiveSession(id)
      return outcome
    } catch (error) {
      if (outcome !== true) return outcome
      return {
        ok: false,
        code: 'session/detach-failed',
        message: `The Session was stopped but could not be unarchived, so nothing was removed: ${messageOf(error)}`,
      }
    }
  }
}

/**
 * Flush, then tear down whatever still holds the Session.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} id - Session identity.
 * @returns {Promise<true | { ok: false, code: string, message: string }>} `true` once nothing holds it.
 */
async function detachRegistries(ctx, id) {
  const session = ctx.sessions.get(id)
  if (session === undefined) {
    if (ctx.agents.get(id) !== undefined) {
      return {
        ok: false,
        code: 'session/detach-failed',
        message: 'The Session is being resumed in DSH. Try again in a moment.',
      }
    }
    return true
  }
  try {
    await withTimeout(ctx.sessions.flush(session), STOP_TIMEOUT_MS)
  } catch (error) {
    return {
      ok: false,
      code: 'session/detach-failed',
      message: `The Session's final events could not be written: ${messageOf(error)}`,
    }
  }
  // Re-read at the moment of teardown: a resume between the decision and here
  // would otherwise leave the replacement Agent running over a deleted log.
  const owner = ctx.agents.get(id) ?? session
  try {
    await withTimeout(disposeOwner(owner, session), DETACH_TIMEOUT_MS)
  } catch (error) {
    return {
      ok: false,
      code: 'session/detach-failed',
      message: `The Session could not be closed: ${messageOf(error)}`,
    }
  }
  const released = await waitFor(
    () => ctx.sessions.get(id) === undefined && ctx.agents.get(id) === undefined,
    DETACH_TIMEOUT_MS,
  )
  if (!released) {
    return {
      ok: false,
      code: 'session/detach-failed',
      message: 'The Session is still loaded in DSH. Restart DSH and delete it again.',
    }
  }
  return true
}

/**
 * Dispose the fiber that owns a Session's Agent (or the Session itself), and
 * await the ordered teardown it runs. The Agent's own teardown — owned by the
 * Session Controller for a GUI Session — stops the loop, drains it, closes the
 * persistence write handle, and only then leaves the registries.
 * @param {object} owner - live Agent, or the Session when no Agent exists.
 * @param {import('@deepseek-ai/dsh-session').Session} session - live Session.
 * @returns {Promise<unknown>} the teardown settlement.
 */
function disposeOwner(owner, session) {
  const target = owner.ctx ?? Reflect.get(session, 'ctx')
  const fiber = target === undefined || target === null ? undefined : Reflect.get(target, 'fiber')
  const disposeFiber = fiber === undefined || fiber === null ? undefined : Reflect.get(fiber, 'dispose')
  if (typeof disposeFiber === 'function') return disposeFiber.call(fiber)
  const disposeContext = target === undefined || target === null ? undefined : Reflect.get(target, 'dispose')
  if (typeof disposeContext === 'function') return disposeContext.call(target)
  return undefined
}

/**
 * Remove one log file, retrying while a just-closed handle still holds it.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} id - Session identity, for diagnostics only.
 * @param {string} path - canonical log file.
 */
async function removeWhenUnlocked(ctx, id, path) {
  const deadline = Date.now() + UNLOCK_TIMEOUT_MS
  while (true) {
    try {
      await rm(path, { force: true })
      return
    } catch (error) {
      const code = error?.code
      if ((code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') || Date.now() > deadline) throw error
      ctx.logger?.warn?.(`session-delete: session "${id}" log is still locked, retrying`)
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
    }
  }
}

/**
 * Await a possibly absent operation, refusing after `timeoutMs`.
 * @param {Promise<unknown> | undefined} operation - pending work.
 * @param {number} timeoutMs - deadline.
 * @returns {Promise<void>} settlement.
 */
async function withTimeout(operation, timeoutMs) {
  if (operation === undefined || operation === null) return
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no settlement within ${timeoutMs} ms`))
    }, timeoutMs)
  })
  try {
    await Promise.race([Promise.resolve(operation), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Poll a predicate until it holds or the deadline passes.
 * @param {() => boolean} predicate - condition to reach.
 * @param {number} timeoutMs - deadline.
 * @returns {Promise<boolean>} whether the predicate held.
 */
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  return true
}

/**
 * @param {unknown} error - rejected operation.
 * @returns {string} a diagnostic message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON body.
 * @returns {Response} JSON response.
 */
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
