// Shapes returned by the API (see server/README.md).

export const ACCOUNT_TYPES = ['Client', 'Prospect', 'Partner', 'Vendor', 'Network', 'Community', 'Internal'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACTIVITY_TYPES = ['Note', 'Call', 'Meeting', 'Lunch', 'Email', 'Text'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const STAGES = ['Lead', 'Qualified', 'Scoping', 'Proposal Sent', 'Verbally Committed', 'Won', 'Lost'] as const
export type Stage = (typeof STAGES)[number]

export interface Account {
  id: string
  name: string
  aliases: string[]
  type: AccountType | null
  category: string
  phone: string
  website: string
  address: string
  billingAttn: string
  billingEmail: string
  keywords: string
  notes: string
  source: string
  followUp: string | null
  dateAdded: string | null
  createdAt: string
  updatedAt: string
}

export type AccountInput = Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt'>>

export interface AccountStats {
  accountId: string
  people: number
  hours: number
  hoursYear: number
  valueYear: number
  milesYear: number
  tripsYear: number
  trips: number
  lastActivity: string | null
}

export interface AccountSummary extends AccountStats {
  year: number
  tasks: {
    taskId: string
    taskNumber: number
    name: string
    type: string
    billRate: number
    active: boolean
    projectCode: string
    projectName: string
    resourceName: string
    hoursYear: number
    hours: number
  }[]
}

export interface Contact {
  id: string
  accountId: string | null
  name: string
  firstName: string
  lastName: string
  title: string
  company: string
  emails: string[]
}

export interface Activity {
  id: string
  contactId: string | null
  accountId: string | null
  opportunityId: string | null
  activityDate: string
  type: ActivityType
  body: string
  createdAt: string
}

export interface Resource {
  id: string
  name: string
  email: string
  contractor: boolean
  active: boolean
}

export interface Project {
  id: string
  code: string
  name: string
  type: 'T&M' | 'Flat Fee'
  accountId: string | null
}

export interface Task {
  id: string
  taskNumber: number
  projectId: string
  resourceId: string
  name: string
  type: 'T&M' | 'Flat Fee'
  billRate: number
  costRate: number
  budgetHours: number
  active: boolean
}

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'returned'

export interface TimesheetLine {
  id: string
  taskId: string
  taskNumber: number
  taskName: string
  taskType: string
  taskActive: boolean
  billRate: number
  costRate: number
  projectId: string
  projectCode: string
  projectName: string
  accountId: string | null
  accountName: string | null
  note: string
  hours: number[]
  billed: boolean[]
}

export interface Timesheet {
  id: string | null
  resourceId: string
  resourceName: string
  weekStart: string
  status: TimesheetStatus
  submittedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  returnNote: string
  lines: TimesheetLine[]
  totals: { hours: number; billableHours: number; billValue: number; cost: number; days: number[] }
}

/** One row of GET /timesheets (no lines, with totals). */
export interface TimesheetSummary {
  id: string
  resourceId: string
  resourceName: string
  weekStart: string
  status: TimesheetStatus
  submittedAt: string | null
  approvedAt: string | null
  returnNote: string
  totalHours: number
  billableHours: number
  billValue: number
  cost: number
}

export interface Trip {
  id: string
  tripDate: string
  kind: 'business' | 'charitable'
  resourceId: string | null
  miles: number
}

export interface Opportunity {
  id: string
  name: string
  accountId: string | null
  stage: Stage
  value: number
  targetClose: string | null
}
