import { expect, mock, test } from 'claude-code/testing'

// Draws the band from made-up sample data and prints the drawn tree, for tools/make-docs-images.sh to turn
// into the README's SVGs. It is a test too: the band must draw every kind of row from this data.

const HOME = '/home/demo'
const FILES: Record<string, string> = {
  [`${HOME}/.claude/progress/docs-site.json`]: JSON.stringify({
    title: 'Docs site',
    items: [
      { label: 'Pages written', done: 18, total: 24 },
      { label: 'Screenshots', done: 4, total: 12 },
      { label: 'Link check', done: 211, total: 214 },
      { label: 'Review', note: 'reviewer: reading the API pages' },
    ],
  }),
}

const AGENTS = [
  { id: 'a1', name: 'writer', description: 'Write the remaining guide pages', type: 'teammate', status: 'running' },
  { id: 'a2', name: 'reviewer', description: 'Review each page as it lands', type: 'teammate', status: 'running' },
  { id: 'a3', name: 'shots', description: 'Capture the screenshots', type: 'teammate', status: 'idle' },
]

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { firstRow: 0, bodyRows: 19 }, view: {} },
})

test('draws the README sample: bars, a note row and agents, still and mid-change', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let screenshots = 4
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === `${HOME}/.claude/progress` ? [{ name: 'docs-site.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', ($, e) => ({ value: (FILES[e.path] ?? '').replace('"done":4,', `"done":${screenshots},`) }))
  on('fs.exists', () => ({ value: true }))
  on('agent.list', () => ({ value: AGENTS }))
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await clock.advance(23 * 60000) // the agents have been running a while
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Finish the docs site with the team', turnId: 't1' }) // the lead, at work too
  await clock.advance(31 * 60000)

  const ui = await $.ui.mount({ plugin: 'progress-band', surface: 'terminal', ...band(64) } as never)
  expect(await ui.find({ type: 'Text', text: /18\/24/ })).toBeDefined()
  console.log('@@still ' + JSON.stringify(await ui.drawn()))

  // A bar moves and an agent finishes: the frame's rainbow, the moved bar's stripes, the agent's shimmer.
  screenshots = 7
  AGENTS[2]!.status = 'completed'
  await clock.advance(5000)
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: /7\/12/ })).toBeDefined()
  console.log('@@change ' + JSON.stringify(await ui.drawn()))
  await ui.unmount()
})
