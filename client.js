/**
 * Browser half of the session-delete bundle.
 *
 * Adds a "Delete session" row to the Session context menu (right-click and the
 * row's More button), asks for confirmation, calls the Host route, refreshes the
 * Session list, and leaves the conversation when the deleted Session was open.
 */
window.__ModuleLoader__.load({
  id: '@ly14081622/session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sessionDelete'

    const en = {
      'menu.delete': 'Delete session',
      'menu.deleteRunning': 'Delete session (stops the running turn)',
      'dialog.title': 'Delete session',
      'dialog.body': 'This permanently deletes “{title}” and its entire history from disk. This cannot be undone.',
      'dialog.bodyRunning': '“{title}” is still running: deleting it stops the current turn, its background jobs, and its subagents first, then removes it from disk. This cannot be undone.',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close',
      'dialog.confirm': 'Delete session',
      'dialog.deleting': 'Deleting…',
      'toast.deleted': 'Session deleted',
      'toast.deletedOpen': 'Session deleted; the view moved to a new session.',
      'toast.alreadyGone': 'That session no longer exists; the list was refreshed.',
      'toast.refreshFailed': 'Session deleted, but the session list could not refresh.',
      'error.subagent': 'This is a subagent session; delete the session that runs it instead.',
      'error.stopFailed': 'The running work could not be stopped: {message}',
      'error.detachFailed': 'The session could not be closed: {message}',      'error.notFound': 'The session file was not found; it may already be deleted.',
      'error.unmaterialized': 'This session was created but never written to disk, so there is nothing to delete.',
      'error.unsafePath': 'The stored path did not look like a session log, so nothing was deleted.',
      'error.deleteFailed': 'The session log could not be deleted: {message}',
      'error.requestFailed': 'The delete request failed: {message}',
    }

    const zh = {
      'menu.delete': '删除会话',
      'menu.deleteRunning': '删除会话（会停止正在运行的轮次）',
      'dialog.title': '删除会话',
      'dialog.body': '将从磁盘永久删除“{title}”及其全部历史记录，此操作无法恢复。',
      'dialog.bodyRunning': '“{title}”仍在运行：删除时会先停止当前轮次、后台任务和子代理，再从磁盘移除。此操作无法恢复。',
      'dialog.cancel': '取消',
      'dialog.close': '关闭',
      'dialog.confirm': '删除会话',
      'dialog.deleting': '正在删除…',
      'toast.deleted': '会话已删除',
      'toast.deletedOpen': '会话已删除，已切换到新会话。',
      'toast.alreadyGone': '该会话已不存在，列表已刷新。',
      'toast.refreshFailed': '会话已删除，但列表刷新失败。',
      'error.subagent': '这是子代理会话，请删除运行它的父会话。',
      'error.stopFailed': '无法停止正在运行的工作：{message}',
      'error.detachFailed': '无法关闭该会话：{message}',
      'error.notFound': '找不到会话文件，它可能已被删除。',
      'error.unmaterialized': '该会话尚未写入磁盘，没有可删除的文件。',
      'error.unsafePath': '该会话的存储路径不是有效的会话日志文件，已拒绝删除。',
      'error.deleteFailed': '无法删除会话日志：{message}',
      'error.requestFailed': '删除请求失败：{message}',
    }

    const ERROR_KEYS = {
      'session/subagent': 'error.subagent',
      'session/stop-failed': 'error.stopFailed',
      'session/detach-failed': 'error.detachFailed',
      'session/not-found': 'error.notFound',
      'session/unmaterialized': 'error.unmaterialized',
      'session/unsafe-path': 'error.unsafePath',
      'session/delete-failed': 'error.deleteFailed',
    }

    // Copied host dialog patterns (not imported): token-only colors, outline
    // destructive button with an error-red label, and real hover/focus states.
    const STYLE = `
      .dsh-session-delete-mask{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:16px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));}
      .dsh-session-delete-card{position:relative;box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px 20px 18px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-2,#202430);color:var(--dsw-alias-label-primary,#e8eaee);box-shadow:var(--dsw-elevation-panel,0 24px 64px rgba(0,0,0,.35));font:inherit;}
      .dsh-session-delete-card:focus{outline:none;}
      .dsh-session-delete-title{margin:0;padding-right:28px;font-size:15px;font-weight:600;line-height:22px;}
      .dsh-session-delete-body{margin:8px 0 0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,rgba(232,234,238,.72));overflow-wrap:anywhere;}
      .dsh-session-delete-error{margin:12px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e5484d);}
      .dsh-session-delete-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px;}
      .dsh-session-delete-btn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));background:transparent;color:var(--dsw-alias-label-primary,#e8eaee);font:inherit;font-size:13px;cursor:pointer;transition:background .12s ease;}
      .dsh-session-delete-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}
      .dsh-session-delete-btn:focus-visible{outline:2px solid var(--dsw-alias-border-selected,#247bbf);outline-offset:1px;}
      .dsh-session-delete-btn:disabled{opacity:.6;cursor:default;}
      .dsh-session-delete-btn--danger{color:var(--dsw-alias-state-error-primary,#e5484d);}
      .dsh-session-delete-btn--danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12));}
      .dsh-session-delete-close{position:absolute;top:12px;right:12px;width:24px;height:24px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(232,234,238,.5));font-size:18px;line-height:1;cursor:pointer;}
      .dsh-session-delete-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,#e8eaee);}
      .dsh-session-delete-close:focus-visible{outline:2px solid var(--dsw-alias-border-selected,#247bbf);outline-offset:1px;}
    `

    /**
     * @param {unknown} value - rejected or unexpected value.
     * @returns {string} diagnostic text.
     */
    function messageOf(value) {
      return value instanceof Error ? value.message : String(value)
    }

    return {
      inject: ['slots', 'contextMenus', 'sessions', 'locale'],

      /**
       * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-delete: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', '@ly14081622/session-delete')
          style.textContent = STYLE
          document.head.append(style)
          return () => {
            style.remove()
          }
        }, 'session-delete: dialog styles')

        // One pending confirmation shared by the menu action and the overlay.
        let pending = null
        const listeners = new Set()
        const publish = () => {
          for (const listener of [...listeners]) listener()
        }
        // The element that opened the dialog: the action runs inside its click,
        // so document.activeElement is already the menu item, not the row.
        let openerElement = null
        const requestDelete = (target) => {
          const summary = ctx.sessions.list.getSnapshot().byId[target.sessionId]
          openerElement = document.activeElement
          pending = {
            sessionId: target.sessionId,
            title: target.displayTitle,
            running: summary !== undefined && summary.running === true,
          }
          publish()
        }
        const closeDialog = () => {
          const opener = openerElement
          openerElement = null
          pending = null
          publish()
          if (opener !== null && typeof opener?.focus === 'function') {
            setTimeout(() => {
              opener.focus()
            }, 0)
          }
        }

        /**
         * @param {string} sessionId - Session identity.
         * @returns {boolean} whether this page keeps it open in the main view.
         */
        const wasOpenInView = (sessionId) => {
          const row = ctx.sessions.list.getSnapshot().byId[sessionId]
          return row !== undefined && (row.retainedBy?.mainView ?? 0) > 0
        }

        /**
         * Report the outcome and move the page off a Session that no longer exists.
         * @param {{ refreshed: boolean, left: boolean }} result - what the deletion changed.
         */
        const announceDeleted = (result) => {
          if (!result.refreshed) {
            ctx.contextMenus.notify(t('toast.refreshFailed'), false)
            return
          }
          ctx.contextMenus.notify(t(result.left ? 'toast.deletedOpen' : 'toast.deleted'), true)
        }

        /** Reload the Host-authoritative Session list; false when the refresh failed. */
        const refreshList = async () => {
          try {
            await ctx.sessions.refresh()
            return true
          } catch (reason) {
            console.warn('session-delete: Session list refresh failed:', reason)
            return false
          }
        }

        /**
         * Call the Host route and reduce its per-id outcome.
         * @param {string} sessionId - Session to delete.
         * @returns {Promise<{ ok: true } | { ok: false, code?: string, message: string }>} outcome.
         */
        const deleteOnHost = async (sessionId) => {
          const response = await fetch('api/session.delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionIds: [sessionId] }),
          })
          const payload = await response.json().catch(() => null)
          if (payload === null || payload.ok !== true) {
            return {
              ok: false,
              message: payload?.error?.message ?? `HTTP ${response.status}`,
            }
          }
          const failure = (payload.failed ?? []).find(entry => entry?.id === sessionId)
          if (failure !== undefined) {
            return { ok: false, code: failure.code, message: String(failure.message ?? '') }
          }
          return { ok: true }
        }

        /**
         * After the log is gone, close the conversation this browser still shows.
         * The Host disposes the Agent, but the page would otherwise keep a dead
         * conversation open until the next reload.
         * @param {string} sessionId - deleted Session identity.
         */
        const leaveSession = async (sessionId) => {
          const navigation = ctx.get('uiWorkspace')
          if (navigation === undefined || typeof navigation.startSession !== 'function') return false
          try {
            navigation.startSession()
            return true
          } catch (reason) {
            console.warn('session-delete: opening a replacement session failed:', reason)
            return false
          }
        }

        /**
         * @param {{ code?: string, message: string }} outcome - failed outcome.
         * @returns {string} localized message.
         */
        const describeFailure = (outcome) => {
          const key = outcome.code === undefined ? undefined : ERROR_KEYS[outcome.code]
          if (key !== undefined) return t(key, { message: outcome.message })
          return t('error.requestFailed', { message: outcome.message })
        }

        function DeleteSessionDialog() {
          const [request, setRequest] = React.useState(pending)
          const [busy, setBusy] = React.useState(false)
          const [error, setError] = React.useState(null)
          const cancelRef = React.useRef(null)
          const cardRef = React.useRef(null)

          React.useEffect(() => {
            const listener = () => {
              setRequest(pending)
              setError(null)
              setBusy(false)
            }
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          }, [])

          React.useEffect(() => {
            if (request === null) return undefined
            const onKeyDown = (event) => {
              if (event.key === 'Escape' && !busy) {
                event.stopPropagation()
                closeDialog()
                return
              }
              if (event.key !== 'Tab') return
              const card = cardRef.current
              if (card === null) return
              const focusable = [...card.querySelectorAll('button:not([disabled])')]
              if (focusable.length === 0) {
                event.preventDefault()
                card.focus()
                return
              }
              const first = focusable[0]
              const last = focusable[focusable.length - 1]
              const active = document.activeElement
              if (!card.contains(active)) {
                event.preventDefault()
                first.focus()
                return
              }
              if (event.shiftKey && active === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && active === last) {
                event.preventDefault()
                first.focus()
              }
            }
            document.addEventListener('keydown', onKeyDown)
            const handle = setTimeout(() => {
              cancelRef.current?.focus()
            }, 0)
            return () => {
              document.removeEventListener('keydown', onKeyDown)
              clearTimeout(handle)
            }
          }, [request, busy])

          if (request === null) return null

          /**
           * @param {string} sessionId - Session to remove.
           * @param {boolean} wasOpen - whether this page had it open in the main view.
           */
          const finish = async (sessionId, wasOpen) => {
            closeDialog()
            let left = false
            if (wasOpen) {
              // Leave the deleted conversation before the list changes, so the
              // view never renders a Session that no longer exists.
              left = await leaveSession(sessionId)
            }
            const refreshed = await refreshList()
            announceDeleted({ refreshed, left })
          }

          const confirm = async () => {
            if (busy) return
            setBusy(true)
            setError(null)
            let outcome
            try {
              outcome = await deleteOnHost(request.sessionId)
            } catch (reason) {
              setError(t('error.requestFailed', { message: messageOf(reason) }))
              setBusy(false)
              return
            }
            if (!outcome.ok) {
              setError(describeFailure(outcome))
              setBusy(false)
              if (outcome.code === 'session/not-found') {
                closeDialog()
                const refreshed = await refreshList()
                ctx.contextMenus.notify(t(refreshed ? 'toast.alreadyGone' : 'toast.refreshFailed'), refreshed)
              }
              // Anything else keeps the dialog open with the reason, so the
              // user can read it and decide whether to try again.
              return
            }
            await finish(request.sessionId, wasOpenInView(request.sessionId))
          }

          return h('div', {
            className: 'dsh-session-delete-mask',
            role: 'presentation',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget && !busy) closeDialog()
            },
          }, h('div', {
            ref: cardRef,
            className: 'dsh-session-delete-card',
            role: 'dialog',
            tabIndex: -1,
            'aria-modal': 'true',
            'aria-busy': busy,
            'aria-labelledby': 'session-delete-dialog-title',
          },
          h('button', {
            type: 'button',
            className: 'dsh-session-delete-close',
            'aria-label': t('dialog.close'),
            disabled: busy,
            onClick: closeDialog,
          }, '×'),
          h('h2', {
            id: 'session-delete-dialog-title',
            className: 'dsh-session-delete-title',
          }, t('dialog.title')),
          h('p', { className: 'dsh-session-delete-body' },
            request.running === true
              ? t('dialog.bodyRunning', { title: request.title === '' ? request.sessionId : request.title })
              : t('dialog.body', { title: request.title === '' ? request.sessionId : request.title })),
          error === null ? null : h('p', { role: 'alert', className: 'dsh-session-delete-error' }, error),
          h('div', { className: 'dsh-session-delete-footer' },
            h('button', {
              ref: cancelRef,
              type: 'button',
              className: 'dsh-session-delete-btn',
              disabled: busy,
              onClick: closeDialog,
            }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: 'dsh-session-delete-btn dsh-session-delete-btn--danger',
              disabled: busy,
              onClick: () => {
                void confirm()
              },
            }, busy ? t('dialog.deleting') : t('dialog.confirm')),
          )))
        }

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete.dialog',
        }, DeleteSessionDialog))

        function TrashGlyph() {
          return h('svg', {
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            'aria-hidden': true,
            style: { display: 'block' },
          },
          h('rect', { x: 3, y: 3.6, width: 10, height: 1.6, rx: 0.8, fill: 'currentColor' }),
          h('rect', { x: 6.1, y: 1.8, width: 3.8, height: 1.6, rx: 0.8, fill: 'currentColor' }),
          h('path', { d: 'M4.3 6.4h7.4l-.7 7.9a1.3 1.3 0 0 1-1.3 1.2H6.3a1.3 1.3 0 0 1-1.3-1.2z', fill: 'currentColor' }))
        }

        ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
          name: 'contextMenu.icon',
          key: 'session-delete.trash',
        }, TrashGlyph))

        ctx.effect(() => ctx.contextMenus.register({
          id: 'session.delete',
          target: 'session',
          order: 700,
          observe: () => [ctx.sessions.list],
          resolve: (target) => {
            const summary = ctx.sessions.list.getSnapshot().byId[target.sessionId]
            const running = summary !== undefined && summary.running === true
            return [{
              id: 'delete',
              label: running ? t('menu.deleteRunning') : t('menu.delete'),
              icon: { key: 'session-delete.trash' },
              danger: true,
              separatorBefore: true,
              afterContent: true,
              run: () => {
                requestDelete(target)
              },
            }]
          },
        }), 'session-delete: Session menu')
      },
    }
  },
})
