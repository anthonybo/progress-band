import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentRow, Clocks, DoneSince, ProgressItem, Snapshot } from '../types'

// Any task can show here: drop a JSON file in ~/.claude/progress/ (format in README.md beside this mod).
const snapshot = atom({ plugin: 'progress-band', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'progress-band', key: 'isHidden' } as const, false)

const POLL_MS = 5000
// Agents that are gone stop taking rows.
const HIDDEN_STATUS = new Set(['killed'])

type FileItem = { label?: unknown; done?: unknown; total?: unknown; countLines?: unknown; note?: unknown }
type FileShape = { title?: unknown; items?: unknown }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

async function countLines($: EngineInterface, path: string): Promise<number> {
  const text = await $.fs.read(path)
  let n = 0
  for (const line of text.split('\n')) if (line.trim() !== '') n += 1
  return n
}

/**
 * Where progress files live: `progress/` in Claude Code's configuration folder, which is CLAUDE_CONFIG_DIR
 * when set, else `.claude` in the home folder (HOME on macOS and Linux, USERPROFILE on Windows).
 */
async function progressDir($: EngineInterface): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config !== undefined && config !== '') return `${config.replace(/[\\/]+$/, '')}/progress`
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return `${home}/.claude/progress`
}

async function readItems($: EngineInterface, dir: string, errors: string[]): Promise<ProgressItem[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name).sort()
  const items: ProgressItem[] = []
  for (const name of files) {
    let parsed: FileShape
    try {
      parsed = JSON.parse(await $.fs.read(`${dir}/${name}`)) as FileShape
    } catch {
      errors.push(`${name}: not valid JSON`)
      continue
    }
    const group = str(parsed.title) ?? name.replace(/\.json$/, '')
    const list = Array.isArray(parsed.items) ? (parsed.items as FileItem[]) : []
    for (const it of list) {
      const label = str(it.label)
      if (label === undefined) continue
      const item: ProgressItem = { group, label, total: num(it.total), note: str(it.note) }
      // One file or a list of files, their non-empty lines summed; a missing file counts 0.
      const paths = Array.isArray(it.countLines)
        ? it.countLines.filter((p): p is string => typeof p === 'string')
        : str(it.countLines) !== undefined ? [it.countLines as string] : []
      if (paths.length > 0) {
        let sum = 0
        for (const path of paths) {
          if (!(await $.fs.exists(path))) continue
          sum += await countLines($, path).catch(() => {
            errors.push(`${label}: cannot read ${path}`)
            return 0
          })
        }
        item.done = sum
      } else {
        item.done = num(it.done)
      }
      items.push(item)
    }
  }
  return items
}

// When the band first saw each agent. Loaded from and saved to $.state, so a reload of the mod keeps it
// (agents end with the session, so this need not outlive it).
const firstSeen = new Map<string, number>()
const clocks = atom({ plugin: 'progress-band', key: 'agentClocks' } as const, { firstSeen: {} })
let clocksLoaded = false
// Finished rows' clocks are in $.store instead: $.state lasts only as long as the session process, so a
// reopened session saw every finished row as newly finished and showed it again for two minutes.
const DONE_KEY = 'doneSince'
let savedDone = ''
// The last rows drawn; a change runs a rainbow round the frame for RAINBOW_MS, then it stops (no idle cost).
let lastKey = ''
let rainbowUntil = 0
let stopRainbow: (() => void) | undefined
const RAINBOW_MS = 15000
const RAINBOW_STEP_MS = 100

const phase = atom({ plugin: 'progress-band', key: 'phase' } as const, -1)
// Each row's last count and note, and the rows that moved since the rainbow started.
const lastRow = new Map<string, string>()
const movedRows = new Set<string>()
// Each agent's last status, and the agents whose status changed since the rainbow started.
const lastStatus = new Map<string, string>()
const movedAgents = new Set<string>()
let hasPolled = false
const rowKey = (it: ProgressItem) => `${it.group}/${it.label}`
// A finished row stays this long so its completion is seen, then leaves; it returns if its count changes.
// Kept in $.store, so neither a reload nor a reopened session restarts the two minutes.
const DONE_LINGER_MS = 120000
const doneSince = new Map<string, { at: number; value: string }>()

async function loadClocks($: EngineInterface) {
  if (clocksLoaded) return
  clocksLoaded = true
  const saved = await read($, clocks)
  for (const [k, v] of Object.entries(saved.firstSeen)) firstSeen.set(k, v)
  const done = (await $.store.get(DONE_KEY).catch(() => undefined)) as DoneSince | undefined
  if (done !== null && typeof done === 'object') {
    for (const [k, v] of Object.entries(done)) {
      if (typeof v?.at === 'number' && typeof v.value === 'string') doneSince.set(k, v)
    }
  }
  savedDone = JSON.stringify(Object.fromEntries(doneSince))
}

async function saveClocks($: EngineInterface, rowKeys: Set<string>) {
  const next: Clocks = { firstSeen: Object.fromEntries(firstSeen) }
  await update($, clocks, prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  // A row no longer in any file is forgotten, so the store holds only what is on screen or waiting.
  for (const k of [...doneSince.keys()]) if (!rowKeys.has(k)) doneSince.delete(k)
  const done = JSON.stringify(Object.fromEntries(doneSince))
  if (done !== savedDone) {
    savedDone = done
    await $.store.set(DONE_KEY, Object.fromEntries(doneSince)).catch(() => {})
  }
}

function isFinishedLongAgo(it: ProgressItem, now: number): boolean {
  const k = rowKey(it)
  const value = `${it.done ?? ''}|${it.note ?? ''}`
  if (it.total === undefined || it.done === undefined || it.done < it.total) {
    doneSince.delete(k)
    return false
  }
  const seen = doneSince.get(k)
  if (seen === undefined || seen.value !== value) {
    doneSince.set(k, { at: now, value })
    return false
  }
  return now - seen.at > DONE_LINGER_MS
}

/** The colour mixed toward white, for the light stripes of a bar that just moved. */
function lighten(hex: string, by: number): string {
  const v = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * by).toString(16).padStart(2, '0')
  return `#${mix(v(1))}${mix(v(3))}${mix(v(5))}`
}

/** A bright, readable colour for a hue in degrees. */
function hueHex(deg: number): string {
  const h = (((deg % 360) + 360) % 360) / 60
  const c = 0.8
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round((v + 0.2) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// Status colours made for dark backgrounds (GitHub's dark theme): vivid without glaring.
const PROGRESS_STOPS: [number, number, number][] = [
  [0xe5, 0x53, 0x4b],
  [0xf0, 0x88, 0x3e],
  [0xd4, 0xa7, 0x2c],
  [0x3f, 0xb9, 0x50],
]

// The empty part of a bar: dark enough to read as track, light enough to see on a dark background.
const TRACK = '#3d434b'

/** A bar's colour for a fraction done: red, orange, gold, then green. */
function progressColor(frac: number): string {
  const t = Math.max(0, Math.min(1, frac)) * (PROGRESS_STOPS.length - 1)
  const i = Math.min(PROGRESS_STOPS.length - 2, Math.floor(t))
  const [a, b] = [PROGRESS_STOPS[i]!, PROGRESS_STOPS[i + 1]!]
  const f = t - i
  return '#' + a.map((v, k) => Math.round(v + (b[k]! - v) * f).toString(16).padStart(2, '0')).join('')
}

async function tickRainbow($: EngineInterface) {
  if ((await $.clock.now()) > rainbowUntil) {
    stopRainbow?.()
    stopRainbow = undefined
    movedRows.clear()
    movedAgents.clear()
    await update($, snapshot, prev =>
      prev === null
        ? prev
        : {
            ...prev,
            items: prev.items.map(i => ({ ...i, moved: false })),
            agents: prev.agents.map(a => ({ ...a, moved: false })),
          },
    )
    await update($, phase, () => -1)
    return
  }
  await update($, phase, p => (p < 0 ? 0 : p + 1))
}

function startRainbow($: EngineInterface, now: number) {
  rainbowUntil = now + RAINBOW_MS
  if (stopRainbow !== undefined) return
  const timer = $.clock.every(RAINBOW_STEP_MS, () => {
    void tickRainbow($)
  })
  stopRainbow = () => timer.cancel()
}

async function refresh($: EngineInterface) {
  const errors: string[] = []
  const now = await $.clock.now()
  await loadClocks($)
  const allItems = await readItems($, await progressDir($), errors)
  const items = allItems.filter(it => !isFinishedLongAgo(it, now))
  const agents: AgentRow[] = (await $.agent.list().catch(() => []))
    .filter(a => !HIDDEN_STATUS.has(a.status))
    .map(a => {
      if (!firstSeen.has(a.id)) firstSeen.set(a.id, now)
      return {
        id: a.id,
        name: a.name ?? a.type,
        description: a.description,
        status: a.status,
        since: firstSeen.get(a.id) ?? now,
      }
    })
  // An agent gone from the list is forgotten, so one restarted under the same name counts from its new start.
  const present = new Set(agents.map(a => a.id))
  for (const id of [...firstSeen.keys()]) if (!present.has(id)) firstSeen.delete(id)
  await saveClocks($, new Set(allItems.map(rowKey)))
  const key = JSON.stringify({ items, agents: agents.map(a => [a.id, a.status, a.description]), errors })
  if (key !== lastKey) {
    if (lastKey !== '') startRainbow($, now)
    lastKey = key
  }
  for (const it of items) {
    const k = rowKey(it)
    const value = `${it.done ?? ''}|${it.note ?? ''}`
    const before = lastRow.get(k)
    if (before !== undefined && before !== value) movedRows.add(k)
    lastRow.set(k, value)
    it.moved = movedRows.has(k)
  }
  for (const a of agents) {
    // After the first poll, a new agent or a status change (started, went idle, finished) counts as moved.
    if (hasPolled && lastStatus.get(a.id) !== a.status) movedAgents.add(a.id)
    lastStatus.set(a.id, a.status)
    a.moved = movedAgents.has(a.id)
  }
  hasPolled = true
  // Minute resolution: elapsed times tick once a minute, everything else redraws only on change.
  const next: Snapshot = { items, agents, errors, now: Math.floor(now / 60000) * 60000 }
  await update($, snapshot, prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
}

// A session launched from inside another Claude session (a teammate's pane) inherits CLAUDECODE; the lead's
// own process does not have it. Only the lead shows the band.
let isTeammate = false

// The band only has bars if Claude writes progress files, so the plugin tells it how: one section at the end
// of the system prompt, in every session (a teammate's work shows on its lead's band). The text depends only
// on the folder, so it never spends the prompt cache.
let promptDir = '~/.claude/progress'
const instructions = (dir: string) => `# Progress band

The user has the progress-band plugin: a live band above their prompt that draws a bar per row of every JSON file in ${dir}/, plus each agent's status. It only shows work you record, so record it.

When you start work that has several steps and will take more than a few minutes (a multi-step plan, a batch job, a team of agents), write ${dir}/<project-or-job>.json:

{ "title": "<project>", "items": [
  { "label": "Pages written", "done": 3, "total": 12 },
  { "label": "Species", "total": 200, "countLines": "/abs/path/species.jsonl" },
  { "label": "Review", "note": "reviewer: reading chunk 2" }
] }

- \`done\` + \`total\`: update \`done\` as each step finishes.
- \`countLines\`: an absolute path (or a list of them) whose non-empty lines are counted for you; prefer it when the work produces one line per item, so the bar is measured rather than typed.
- \`note\` alone: a status line with no bar, for work with no honest percentage.
- Count the whole pipeline, not just the building: include review, tests and install as steps, and use a note to name the current stage, so a bar never sits at "done" while work goes on.
- Delete the row or the file when the job is finished. Skip it for quick, single-step tasks.
- Labels are short (about 16 characters show). Keep one file per project and update it in place.`

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'progress-band:instructions', text: instructions(promptDir), scope: 'session' }] }
  })

  on('session.start', async ($, e, next) => {
    promptDir = await progressDir($)
    isTeammate = (await $.env.get('CLAUDECODE')) !== undefined
    if (isTeammate) return next(e)
    await $.command.register({
      name: 'progress',
      description: 'Show or hide the progress band above the prompt',
    })
    await refresh($)
    $.clock.every(POLL_MS, () => {
      void refresh($)
    })
    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)
    if (hidden) await refresh($)
    return { text: hidden ? 'Progress band shown.' : 'Progress band hidden; /progress shows it again.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (isTeammate || e.props.hasSurvey || (await read($, isHidden)) || snap === null) return next(e)
    if (snap.items.length === 0 && snap.agents.length === 0 && snap.errors.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // The rainbow's step: -1 while still, counting up while it runs (frame and moved bars both use it).
    const step = await read($, phase)
    // The frame is drawn by hand (a Box border has one colour): 2 columns of border, no padding.
    const outer = Math.max(34, e.props.bodyColumns)
    const cols = outer - 2
    const labelW = Math.min(16, Math.max(6, ...snap.items.map(i => i.label.length)))
    // Room for the label, the bar's two borders, and the count and percentage after it.
    const barW = Math.max(6, Math.min(24, cols - labelW - 22))

    const rows: RenderChildren[] = []
    // Titles only tell projects apart; with one project the rows say enough.
    const showGroups = new Set(snap.items.map(i => i.group)).size > 1
    let group = ''
    for (const it of snap.items) {
      if (it.group !== group) {
        group = it.group
        if (showGroups) rows.push(<Text key={`g-${group}`} bold>{group}</Text>)
      }
      const label = it.label.length > labelW ? it.label.slice(0, labelW - 1) + '…' : it.label.padEnd(labelW)
      if (it.total !== undefined && it.total > 0 && it.done !== undefined) {
        const frac = Math.max(0, Math.min(1, it.done / it.total))
        const fill = Math.round(frac * barW)
        // Red at the start, through orange and gold, to green when done.
        const fillColor = progressColor(frac)
        // A lower three-quarter block per cell, one row per bar: the gap at the top of each cell keeps a bar
        // apart from the one above (box rules cost extra rows; full blocks merge rows into one slab; ━ draws
        // as a thin stroke in some fonts). The empty part is the same block in dark grey, so the track shows.
        rows.push(
          <Text key={`i-${group}-${it.label}`} wrap="truncate">
            {label}{' '}
            {it.moved && step >= 0 ? (
              // A bar that just moved: light and dark bands slide along it, like a barber pole turning.
              <Text>
                {Array.from({ length: fill }, (_, x) => (
                  <Text color={(((x - step) % 4) + 4) % 4 < 2 ? lighten(fillColor, 0.55) : fillColor}>▆</Text>
                ))}
              </Text>
            ) : (
              <Text color={fillColor}>{'▆'.repeat(fill)}</Text>
            )}
            <Text color={TRACK}>{'▆'.repeat(barW - fill)}</Text> {String(it.done)}/{String(it.total)}{' '}
            <Text dimColor>
              {Math.round(frac * 100)}%{it.note !== undefined ? ` · ${it.note}` : ''}
            </Text>
          </Text>,
        )
      } else {
        rows.push(
          <Text key={`i-${group}-${it.label}`} wrap="truncate">
            {label} <Text dimColor>{it.note ?? (it.done !== undefined ? String(it.done) : '')}</Text>
          </Text>,
        )
      }
    }

    if (snap.agents.length > 0) {
      rows.push(<Text key="agents-h" bold>Agents</Text>)
      for (const a of snap.agents) {
        const mins = Math.max(0, Math.round((snap.now - a.since) / 60000))
        const dot = a.status === 'running' ? '●' : a.status === 'failed' ? '✗' : a.status === 'completed' ? '✓' : '○'
        const color = a.status === 'running' ? 'success' : a.status === 'failed' ? 'error' : 'subtle'
        rows.push(
          <Text key={`a-${a.id}`} wrap="truncate">
            {a.moved && step >= 0 ? (
              // An agent that just started, went idle or finished: a pulsing dot and its name in a moving rainbow.
              <Text>
                <Text color={step % 6 < 3 ? color : 'text'}>{step % 6 < 3 ? dot : '◉'}</Text>{' '}
                {[...a.name].map((ch, x) => (
                  <Text color={hueHex(x * 30 - step * 24)} bold>
                    {ch}
                  </Text>
                ))}
              </Text>
            ) : (
              <Text>
                <Text color={color}>{dot}</Text> {a.name}
              </Text>
            )}{' '}
            <Text dimColor>{a.status} · {mins}m · {a.description}</Text>
          </Text>,
        )
      }
    }
    for (const err of snap.errors) {
      rows.push(<Text key={`e-${err}`} color="warning" wrap="truncate">{err}</Text>)
    }

    // Each border cell's place round the perimeter, clockwise from the top-left corner, picks its hue.
    const n = rows.length
    const perimeter = 2 * outer + 2 * n
    const at = (i: number) => (step < 0 ? 'claude' : hueHex((i * 720) / perimeter - step * 18))
    const run = (chars: string, firstIndex: number, reverse: boolean) =>
      step < 0 ? (
        <Text color="claude">{chars}</Text>
      ) : (
        <Text>
          {[...chars].map((ch, x) => (
            <Text color={at(reverse ? firstIndex + chars.length - 1 - x : firstIndex + x)}>{ch}</Text>
          ))}
        </Text>
      )

    return (
      <Box flexDirection="column">
        {run('┏' + '━'.repeat(outer - 2) + '┓', 0, false)}
        {rows.map((row, r) => (
          <Box key={`r-${r}`} flexDirection="row">
            <Text color={at(2 * outer + n + (n - 1 - r))}>┃</Text>
            <Box width={cols}>{row}</Box>
            <Text color={at(outer + r)}>┃</Text>
          </Box>
        ))}
        {run('┗' + '━'.repeat(outer - 2) + '┛', outer + n, true)}
      </Box>
    )
  })
}
