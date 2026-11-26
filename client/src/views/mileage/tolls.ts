import type { Trip } from '../../api/types.ts'

/** Turnpike toll for one round trip to McElroy's. */
export const MCELROYS_TOLL = 5.56

/** A trip whose purpose mentions "Work at McElroys" (with or without the apostrophe) is one tolled round trip. */
export const isMcElroysTrip = (t: Trip) => /work at mcelroys/i.test(t.purpose.replace(/['’]/g, ''))
