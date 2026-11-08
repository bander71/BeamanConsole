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

export interface Opportunity {
  id: string
  name: string
  accountId: string | null
  stage: Stage
  value: number
  targetClose: string | null
}
