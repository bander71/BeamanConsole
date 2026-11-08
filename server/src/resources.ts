// Field rules for each table served by the generic CRUD routes.
// Fixed lists here match the CHECK constraints in db/migrations.

import { z } from 'zod';
import type { ResourceDef } from './crud.ts';

// ---- shared field types ----------------------------------------------------

const text = (max = 500) => z.string().trim().max(max);
const name = (max = 200) => z.string().trim().min(1).max(max);
const longText = () => z.string().max(20_000);
const id = () => z.uuid();
const optionalId = () => z.uuid().nullable().optional();
const date = () => z.iso.date();
const optionalDate = () => z.iso.date().nullable().optional();
const money = () => z.number().min(0).max(9_999_999_999.99);
const flag = () => z.boolean();
const textList = () => z.array(text(200)).max(100);
const emailOrBlank = () => z.union([z.email().max(320), z.literal('')]);

export const ACCOUNT_TYPES = ['Client', 'Prospect', 'Partner', 'Vendor', 'Network', 'Community', 'Internal'] as const;
export const BILLING_TYPES = ['T&M', 'Flat Fee'] as const;
export const STAGES = ['Lead', 'Qualified', 'Scoping', 'Proposal Sent', 'Verbally Committed', 'Won', 'Lost'] as const;
export const ACTIVITY_TYPES = ['Note', 'Call', 'Meeting', 'Lunch', 'Email', 'Text'] as const;
export const TRIP_KINDS = ['business', 'charitable'] as const;
export const PAYMENT_METHODS = ['ACH', 'Check', 'Card', 'Wire', 'Cash', 'Other'] as const;
export const EXPENSE_CATEGORIES = [
  'Contractors (1099)', 'Software & subscriptions', 'Travel', 'Meals', 'Vehicle & fuel',
  'Office & supplies', 'Insurance', 'Professional fees', 'Marketing', 'Equipment',
  'Taxes & licenses', 'Bank & payment fees', 'Other expense',
] as const;
export const INCOME_CATEGORIES = ['Consulting revenue (outside invoices)', 'Reimbursements', 'Interest', 'Other income'] as const;

// ---- resources ---------------------------------------------------------------

const employees: ResourceDef = {
  path: '/employees',
  table: 'employees',
  label: 'Employee',
  fields: {
    firstName: name(100),
    lastName: text(100).optional(),
    title: text(200).optional(),
    email: emailOrBlank().nullable().optional(),
    phone: text(50).optional(),
    active: flag().optional(),
  },
  filters: { active: 'bool' },
  search: ['first_name', 'last_name', 'email'],
  orderBy: 'last_name, first_name',
};

const resources: ResourceDef = {
  path: '/resources',
  table: 'resources',
  label: 'Resource',
  fields: {
    name: name(),
    email: emailOrBlank().optional(),
    phone: text(50).optional(),
    address: text().optional(),
    city: text(100).optional(),
    state: text(50).optional(),
    zip: text(20).optional(),
    contractor: flag().optional(),
    employeeId: optionalId(),
    active: flag().optional(),
  },
  filters: { contractor: 'bool', active: 'bool', employeeId: 'uuid' },
  search: ['name', 'email'],
  orderBy: 'name',
};

const accounts: ResourceDef = {
  path: '/accounts',
  table: 'accounts',
  label: 'Account',
  fields: {
    name: name(),
    aliases: textList().optional(),
    type: z.enum(ACCOUNT_TYPES).nullable().optional(),
    category: text(100).optional(),
    phone: text(50).optional(),
    website: text().optional(),
    address: text().optional(),
    billingAttn: text(200).optional(),
    billingEmail: emailOrBlank().optional(),
    keywords: text(1000).optional(),
    notes: longText().optional(),
    source: text(100).optional(),
    followUp: optionalDate(),
    dateAdded: optionalDate(),
  },
  filters: { type: 'text', category: 'text' },
  search: ['name', "array_to_string(aliases, ' ')", 'keywords'],
  orderBy: 'lower(name)',
};

const contacts: ResourceDef = {
  path: '/contacts',
  table: 'contacts',
  label: 'Contact',
  fields: {
    accountId: optionalId(),
    kind: text(50).optional(),
    name: text(200).optional(),
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    nickname: text(100).optional(),
    title: text(200).optional(),
    company: text(200).optional(),
    emails: z.array(z.email().max(320)).max(20).optional(),
    mobile: text(50).optional(),
    businessPhone: text(50).optional(),
    homePhone: text(50).optional(),
    otherPhone: text(50).optional(),
    businessAddress: text().optional(),
    homeAddress: text().optional(),
    website: text().optional(),
    birthday: text(20).optional(),
    category: text(100).optional(),
    relationship: text(100).optional(),
    tags: textList().optional(),
    keywords: text(1000).optional(),
    notes: longText().optional(),
    source: text(100).optional(),
    followUp: optionalDate(),
    dateAdded: optionalDate(),
  },
  filters: { accountId: 'uuid', category: 'text', kind: 'text' },
  search: ['name', 'first_name', 'last_name', 'company', "array_to_string(emails, ' ')", "array_to_string(tags, ' ')"],
  orderBy: 'lower(last_name), lower(first_name), lower(name)',
};

const projects: ResourceDef = {
  path: '/projects',
  table: 'projects',
  label: 'Project',
  fields: {
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, 'Use 1-20 letters, numbers, - or _'),
    name: name(),
    type: z.enum(BILLING_TYPES).optional(),
    accountId: optionalId(),
    contractValue: money().nullable().optional(),
    startDate: optionalDate(),
    endDate: optionalDate(),
  },
  filters: { accountId: 'uuid', type: 'text', code: 'text' },
  search: ['code', 'name'],
  orderBy: 'start_date DESC NULLS LAST, code',
};

const opportunities: ResourceDef = {
  path: '/opportunities',
  table: 'opportunities',
  label: 'Opportunity',
  fields: {
    name: name(),
    accountId: optionalId(),
    repId: optionalId(),
    projectId: optionalId(),
    stage: z.enum(STAGES).optional(),
    type: z.enum(BILLING_TYPES).optional(),
    value: money().optional(),
    targetClose: optionalDate(),
    wonAt: optionalDate(),
    closedAt: optionalDate(),
    description: longText().optional(),
    createdBy: optionalId(),
  },
  filters: { stage: 'text', accountId: 'uuid', repId: 'uuid', projectId: 'uuid' },
  search: ['name', 'description'],
  orderBy: 'target_close NULLS LAST, name',
};

const activities: ResourceDef = {
  path: '/activities',
  table: 'activities',
  label: 'Activity',
  fields: {
    contactId: optionalId(),
    accountId: optionalId(),
    opportunityId: optionalId(),
    activityDate: date(),
    type: z.enum(ACTIVITY_TYPES).optional(),
    body: longText().optional(),
    createdBy: optionalId(),
  },
  filters: { contactId: 'uuid', accountId: 'uuid', opportunityId: 'uuid', type: 'text' },
  search: ['body'],
  dateColumn: 'activity_date',
  orderBy: 'activity_date DESC, created_at DESC',
};

const tasks: ResourceDef = {
  path: '/tasks',
  table: 'tasks',
  label: 'Task',
  fields: {
    taskNumber: z.number().int().min(1).max(2_147_483_647),
    projectId: id(),
    resourceId: id(),
    name: name(),
    type: z.enum(BILLING_TYPES).optional(),
    billRate: money().optional(),
    costRate: money().optional(),
    budgetHours: z.number().min(0).max(999_999).optional(),
    active: flag().optional(),
  },
  filters: { projectId: 'uuid', resourceId: 'uuid', active: 'bool', taskNumber: 'int' },
  search: ['name'],
  orderBy: 'task_number',
};

const vehicles: ResourceDef = {
  path: '/vehicles',
  table: 'vehicles',
  label: 'Vehicle',
  fields: {
    name: name(100),
    startOdometer: z.number().min(0).max(99_999_999).nullable().optional(),
    active: flag().optional(),
  },
  filters: { active: 'bool' },
  orderBy: 'name',
};

const trips: ResourceDef = {
  path: '/trips',
  table: 'trips',
  label: 'Trip',
  fields: {
    tripDate: date(),
    kind: z.enum(TRIP_KINDS).optional(),
    resourceId: optionalId(),
    vehicleId: optionalId(),
    accountId: optionalId(),
    clientName: text(200).optional(),
    contactId: optionalId(),
    contactName: text(200).optional(),
    purpose: text(1000).optional(),
    route: text(2000).optional(),
    odometerStart: z.number().min(0).max(99_999_999).nullable().optional(),
    odometerEnd: z.number().min(0).max(99_999_999).nullable().optional(),
    miles: z.number().min(0).max(9_999_999),
  },
  filters: { kind: 'text', resourceId: 'uuid', vehicleId: 'uuid', accountId: 'uuid' },
  search: ['client_name', 'contact_name', 'purpose', 'route'],
  dateColumn: 'trip_date',
  orderBy: 'trip_date DESC, created_at DESC',
};

const ledgerEntries: ResourceDef = {
  path: '/ledger',
  table: 'ledger_entries',
  label: 'Ledger entry',
  fields: {
    entryDate: date(),
    type: z.enum(['income', 'expense']),
    category: z.enum([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]),
    amount: money().refine((n) => n > 0, 'Amount must be greater than zero'),
    payee: text(200).optional(),
    resourceId: optionalId(),
    accountId: optionalId(),
    method: z.enum(PAYMENT_METHODS).optional(),
    memo: text(1000).optional(),
  },
  filters: { type: 'text', category: 'text', resourceId: 'uuid', accountId: 'uuid' },
  search: ['payee', 'memo'],
  dateColumn: 'entry_date',
  orderBy: 'entry_date DESC, created_at DESC',
};

export const resourceDefs: ResourceDef[] = [
  employees, resources, accounts, contacts, projects, opportunities, activities,
  tasks, vehicles, trips, ledgerEntries,
];
