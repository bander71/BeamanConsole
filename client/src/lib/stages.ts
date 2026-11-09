import type { Stage } from '../api/types.ts'

/** Pill colour for an opportunity stage, as in the prototype. */
export const stageClass = (s: Stage) =>
  s === 'Won' ? 'st-approved' : s === 'Lost' ? 'st-returned' : s === 'Verbally Committed' || s === 'Proposal Sent' ? 'st-submitted' : 'st-draft'
