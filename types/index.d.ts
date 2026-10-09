/** One progress row: a bar when it has a total, a status line when it does not. */
export type ProgressItem = {
  group: string
  label: string
  done?: number
  total?: number
  note?: string
  /** True while the frame's rainbow runs after this row's count or note changed. */
  moved?: boolean
}

/** One agent as the band shows it; `since` is when the band first saw it (ms). */
export type AgentRow = {
  id: string
  name: string
  description: string
  status: string
  since: number
  /** True while the frame's rainbow runs after this agent started, stopped or appeared. */
  moved?: boolean
}

export type Snapshot = {
  items: ProgressItem[]
  agents: AgentRow[]
  errors: string[]
  now: number
}

/** When each agent was first seen: kept in $.state, so a reload of the mod keeps it. */
export type Clocks = {
  firstSeen: Record<string, number>
}

/** When each row reached 100%, and at what count: kept in $.store, so it outlives the session. */
export type DoneSince = Record<string, { at: number; value: string }>

declare module 'claude-code' {
  interface PluginState {
    /** `phase`: the rainbow's step while it runs after a change, -1 while the frame is still. */
    'progress-band': { snapshot: Snapshot | null; isHidden: boolean; phase: number; agentClocks: Clocks }
  }
}
