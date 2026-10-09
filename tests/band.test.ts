import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/tester'
const PROGRESS = JSON.stringify({
  title: 'Docs',
  items: [
    { label: 'Pages', total: 4, countLines: '/data/pages.jsonl' },
    { label: 'Review', note: 'reviewer: reading chapter 2' },
  ],
})

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { firstRow: 0, bodyRows: 19 }, view: {} },
})

test('counts lines into a bar, shows notes and each agent', async ($, on) => {
  // The plugin's reads are answered beneath it: one progress file, a data file of 3 non-empty lines, one agent.
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === `${HOME}/.claude/progress` ? [{ name: 'docs.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('docs.json') ? PROGRESS : 'a\nb\n\nc\n' }))
  on('fs.exists', () => ({ value: true }))
  on('clock.now', () => ({ value: 5 * 60000 }))
  on('agent.list', () => ({
    value: [{ id: 'a1', name: 'writer', description: 'Write chapter 8', type: 'teammate', status: 'running' }],
  }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'progress-band', surface, ...band(60) } as never)
    expect(await ui.find({ type: 'Text', text: /3\/4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /reviewer: reading chapter 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /writer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /┏━+┓/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▆/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /┌|└/ })).toBeUndefined() // no extra rows of box rules
    await ui.unmount()
  }
})

test('a bar that moved shows sliding stripes while the rainbow runs, then goes still', async ($, on) => {
  const clock = mock.clock(on)
  let data = 'a\nb\n\nc\n'
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === `${HOME}/.claude/progress` ? [{ name: 'docs.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('docs.json') ? PROGRESS : data }))
  on('fs.exists', () => ({ value: true }))
  let agentStatus = 'idle'
  on('agent.list', () => ({
    value: [{ id: 'a1', name: 'scout', description: 'a job', type: 'teammate', status: agentStatus }],
  }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })

  // A striped bar is drawn one cell per Text; a still bar is one Text of several cells.
  const stripe = { type: 'Text', text: /^▆$/ } as const
  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...band(60) } as never)
  expect(await ui.find(stripe)).toBeUndefined()

  // A one-letter Text is how a shimmering agent name is drawn; still, the name is plain text.
  const shimmer = { type: 'Text', text: /^s$/ } as const
  expect(await ui.find(shimmer)).toBeUndefined()

  data = 'a\nb\nc\nd\n'
  agentStatus = 'running'
  await clock.advance(5000) // the next poll sees 4/4 and the agent start
  await clock.advance(300) // a few rainbow steps
  expect(await ui.find({ type: 'Text', text: /4\/4/ })).toBeDefined()
  expect(await ui.find(stripe)).toBeDefined()
  expect(await ui.find(shimmer)).toBeDefined()

  await clock.advance(16000) // past the rainbow
  expect(await ui.find(stripe)).toBeUndefined()
  expect(await ui.find(shimmer)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /4\/4/ })).toBeDefined() // finished, but still shown for a while

  await clock.advance(125000) // past two minutes finished
  expect(await ui.find({ type: 'Text', text: /4\/4/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /reviewer: reading chapter 2/ })).toBeDefined() // a note row never ages out
  await ui.unmount()
})

test('a reopened session does not bring back rows that finished in an earlier one', async ($, on) => {
  // What an earlier session saved: Pages reached 4/4 long ago and its two minutes ran out there.
  const saved: Record<string, unknown> = { doneSince: { 'Docs/Pages': { at: 0, value: '4|' } } }
  on('store.get', ($, e) => ({ value: saved[e.key] }))
  on('store.set', ($, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === `${HOME}/.claude/progress` ? [{ name: 'docs.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('docs.json') ? PROGRESS : 'a\nb\nc\nd\n' }))
  on('fs.exists', () => ({ value: true }))
  on('clock.now', () => ({ value: 60 * 60000 }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...band(60) } as never)
  expect(await ui.find({ type: 'Text', text: /4\/4/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /reviewer: reading chapter 2/ })).toBeDefined()
  // And it is still on record for the next reopen.
  expect(saved.doneSince).toEqual({ 'Docs/Pages': { at: 0, value: '4|' } })
  await ui.unmount()
})

test('tells Claude how to write progress files, in the folder of whatever computer it runs on', async ($, on) => {
  const cases: [Record<string, string>, string][] = [
    [{ HOME }, `${HOME}/.claude/progress/`],
    [{ USERPROFILE: 'C:\\Users\\demo' }, 'C:\\Users\\demo/.claude/progress/'], // Windows has no HOME
    [{ HOME, CLAUDE_CONFIG_DIR: '/srv/claude-config/' }, '/srv/claude-config/progress/'],
  ]
  let env: Record<string, string> = {}
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('fs.list', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', ($, e) => e)
  // Stands in for the engine's own system prompt beneath the plugin.
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  for (const [vars, dir] of cases) {
    env = vars
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const { sections } = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
    const ours = sections.find(s => s.id === 'progress-band:instructions')
    expect(ours?.scope).toBe('session')
    expect(ours?.text).toContain(`JSON file in ${dir}`)
    expect(ours?.text).toContain('countLines')
  }
})

test('the lead gets a row while it works: after 30 s alone, and gone when its turn ends', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // Stands in for the engine's own (empty) band beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band')
  })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...band(80) } as never)
  // The row's status text; its name is drawn a letter at a time while the rainbow runs.
  const lead = { type: 'Text', text: /running · \d+m · Add a lead row to the band$/ } as const

  await $.turn.start({ text: '[Image #3] Add a lead row to the band\nand test it', turnId: 't1' })
  await clock.advance(10000) // a quick answer never brings the band up
  expect(await ui.find(lead)).toBeUndefined()

  await clock.advance(25000) // past 30 s of work
  expect(await ui.find(lead)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Image #3|and test it/ })).toBeUndefined() // first line, no image tags

  // A subagent's turn ending is not the lead's.
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'a9', reason: 'answer' } as never)
  await clock.advance(5000)
  expect(await ui.find(lead)).toBeDefined()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(5000)
  expect(await ui.find(lead)).toBeUndefined()
  await ui.unmount()
})

test('a turn already running when the plugin loads still gets a lead row, from the working flag', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band')
  })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const working = band(80)
  working.props.isWorking = true
  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...working } as never)
  await clock.advance(35000)
  expect(await ui.find({ type: 'Text', text: /^running · \d+m$/ })).toBeDefined() // no prompt known, no " · "
  await ui.unmount()
})

test('a teammate session (launched inside another Claude session) draws no band', async ($, on) => {
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'CLAUDECODE' ? '1' : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'docs.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('docs.json') ? PROGRESS : 'a\nb\n' }))
  on('fs.exists', () => ({ value: true }))
  on('clock.now', () => ({ value: 0 }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  // Stands in for the engine's own (empty) band beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band')
  })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...band(60) } as never)
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pages/ })).toBeUndefined()
  await ui.unmount()
})
