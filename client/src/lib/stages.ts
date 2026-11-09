import type { Stage } from '../api/types.ts'

/** Each stage and how likely a deal in it is to close, as in the prototype. Drives the weighted pipeline. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  Lead: 0.1,
  Qualified: 0.25,
  Scoping: 0.4,
  'Proposal Sent': 0.6,
  'Verbally Committed': 0.85,
  Won: 1,
  Lost: 0,
}

export const isOpen = (s: Stage) => s !== 'Won' && s !== 'Lost'

/** Pill colour for an opportunity stage, as in the prototype. */
export const stageClass = (s: Stage) =>
  s === 'Won' ? 'st-approved' : s === 'Lost' ? 'st-returned' : s === 'Verbally Committed' || s === 'Proposal Sent' ? 'st-submitted' : 'st-draft'
