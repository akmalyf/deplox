import { create } from 'zustand'
import type { ProgressBatch, TransferGroup, TransferJob, TransferLogEntry } from '@shared/types'

interface TransfersStore {
  jobs: Record<string, TransferJob>
  groups: Record<string, TransferGroup>
  log: TransferLogEntry[]
  init: (jobs: TransferJob[], groups: TransferGroup[], log: TransferLogEntry[]) => void
  update: (p: { jobs: TransferJob[]; groups: TransferGroup[]; removed?: string[] }) => void
  progress: (b: ProgressBatch) => void
  addLog: (e: TransferLogEntry) => void
}

export const useTransfers = create<TransfersStore>((set) => ({
  jobs: {},
  groups: {},
  log: [],
  init: (jobs, groups, log) => set({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), groups: Object.fromEntries(groups.map((g) => [g.id, g])), log }),
  update: ({ jobs, groups, removed }) =>
    set((st) => {
      const nj = { ...st.jobs }
      const ng = { ...st.groups }
      for (const j of jobs) nj[j.id] = j
      for (const g of groups) ng[g.id] = g
      for (const r of removed ?? []) {
        delete nj[r]
        delete ng[r]
      }
      return { jobs: nj, groups: ng }
    }),
  progress: (b) =>
    set((st) => {
      const nj = { ...st.jobs }
      const ng = { ...st.groups }
      for (const p of b.jobs) if (nj[p.id]) nj[p.id] = { ...nj[p.id], bytes: p.bytes, speedBps: p.speedBps }
      for (const g of b.groups) if (ng[g.id]) ng[g.id] = { ...ng[g.id], bytes: g.bytes, done: g.done }
      return { jobs: nj, groups: ng }
    }),
  addLog: (e) => set((st) => ({ log: [...st.log.slice(-299), e] }))
}))

/** Top-level rows: groups and ungrouped jobs. */
export interface TransferRowItem {
  id: string
  isGroup: boolean
  job?: TransferJob
  group?: TransferGroup
  state: TransferJob['state']
  at: number
}

const ORDER: Record<string, number> = { active: 0, queued: 1, paused: 2, failed: 3, canceled: 4, done: 5 }

export function transferRows(jobs: Record<string, TransferJob>, groups: Record<string, TransferGroup>): TransferRowItem[] {
  const rows: TransferRowItem[] = []
  const groupAt: Record<string, number> = {}
  for (const j of Object.values(jobs)) {
    if (j.groupId) {
      groupAt[j.groupId] = Math.max(groupAt[j.groupId] ?? 0, j.finishedAt ?? j.createdAt)
      continue
    }
    rows.push({ id: j.id, isGroup: false, job: j, state: j.state, at: j.finishedAt ?? j.createdAt })
  }
  for (const g of Object.values(groups)) rows.push({ id: g.id, isGroup: true, group: g, state: g.state, at: groupAt[g.id] ?? 0 })
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.state === 'done' || a.state === 'failed' ? b.at - a.at : a.at - b.at))
}
