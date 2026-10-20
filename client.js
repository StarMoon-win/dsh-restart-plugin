window.__ModuleLoader__.load({
  id: 'dsh-restart-desktop',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace; the same string keys locale/*.json document for the manager. */
    const NS = 'dsh-restart-desktop'
    /** Keep in sync with index.js. */
    const STATUS_PATH = '/dsh-restart-desktop/status'
    const RESTART_PATH = '/dsh-restart-desktop/restart'

    const zh = {
      'restart': '重启',
      'tooltip': '重启应用（完全退出并重新打开）',
      'restarting': '正在重启…',
      'failed': '重启失败',
    }

    const en = {
      'restart': 'Restart',
      'tooltip': 'Restart the app (quit completely and reopen it)',
      'restarting': 'Restarting…',
      'failed': 'Restart failed',
    }

    /**
     * The sidebar-foot action row's own sheet. Sizes and spacing mirror the
     * shipped footer actions (42px row, 12px radius, 36px rail circle) and
     * every colour is a theme token, so the button follows light and dark.
     */
    const CSS = [
      '.dshrb-button{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:1 1 auto;width:100%;min-width:0;height:42px;margin:0 -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#191919);font-family:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}',
      '.dshrb-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dshrb-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:-2px}',
      '.dshrb-button:disabled{cursor:progress}',
      '.dshrb-button[data-phase=failed]{color:var(--dsw-alias-state-error-primary,#d4380d)}',
      '.dshrb-icon{flex:none;display:inline-flex;align-items:center;justify-content:center}',
      '.dshrb-button[data-phase=sending] .dshrb-icon{animation:dshrb-spin 1s linear infinite}',
      '.dshrb-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshrb-button.dshrb-rail{flex:none;width:36px;height:36px;margin:0;padding:0;border-radius:50%;justify-content:center;gap:0}',
      '@keyframes dshrb-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.dshrb-button[data-phase=sending] .dshrb-icon{animation:none}}',
    ].join('\n')

    /** A circular-arrow restart glyph drawn in `currentColor`. */
    function restartGlyph(size) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', { d: 'M20 12a8 8 0 1 1-2.4-5.7' }),
        h('path', { d: 'M20 4.6V9h-4.4' }),
      )
    }

    /**
     * One sidebar-foot action: restart the whole desktop application.
     *
     * @param props - owner share `{ wide }` plus the locale translator `t`.
     */
    function RestartButton(props) {
      const wide = props.wide === true
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [supported, setSupported] = React.useState(undefined)
      const [phase, setPhase] = React.useState('idle')
      const resetTimer = React.useRef(undefined)

      React.useEffect(() => {
        let cancelled = false
        fetch(STATUS_PATH, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`))))
          .then((body) => {
            if (!cancelled) setSupported(body !== null && typeof body === 'object' && body.supported === true)
          })
          .catch(() => {
            if (!cancelled) setSupported(false)
          })
        return () => {
          cancelled = true
          if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
        }
      }, [])

      const restart = React.useCallback(() => {
        if (phase === 'sending') return
        setPhase('sending')
        fetch(RESTART_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.ok !== true) throw new Error(body.error ?? `restart ${response.status}`)
            // The application exits within about a second; keep the pending
            // state until this document goes away with it.
          })
          .catch((error) => {
            console.error('[dsh-restart-desktop] restart failed', error)
            setPhase('failed')
            resetTimer.current = setTimeout(() => setPhase('idle'), 4000)
          })
      }, [phase])

      if (supported !== true) return null

      const label = phase === 'sending' ? t('restarting') : phase === 'failed' ? t('failed') : t('restart')
      const tooltip = phase === 'failed' ? t('failed') : t('tooltip')

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'button',
          {
            key: 'button',
            type: 'button',
            className: wide ? 'dshrb-button' : 'dshrb-button dshrb-rail',
            'data-phase': phase,
            title: tooltip,
            'aria-label': tooltip,
            'aria-busy': phase === 'sending' ? 'true' : undefined,
            disabled: phase === 'sending',
            onClick: restart,
          },
          h('span', { className: 'dshrb-icon' }, restartGlyph(wide ? 16 : 18)),
          wide ? h('span', { className: 'dshrb-label' }, label) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart-desktop: dictionaries')
        // The slot name is a literal on purpose: registration names are read
        // statically when the browser bundle is assembled.
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-restart-desktop',
          order: 30,
          locale: NS,
        }, RestartButton))
      },
    }
  },
})
