import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type Action, type AreaDef, type AreaPermission, useMe } from '../../api/auth.ts'
import { api, getAll } from '../../api/client.ts'
import type { Resource } from '../../api/types.ts'
import { EditableTable, type Column } from '../../components/EditableTable.tsx'
import { text, type Draft } from '../../components/editable.ts'
import { useToast } from '../../components/toast-context.ts'

interface User {
  id: string
  email: string
  name: string
  roleId: string
  roleName: string
  isAdmin: boolean
  resourceId: string | null
  resourceName: string | null
  active: boolean
  linked: boolean
  lastSignInAt: string | null
}

interface Role {
  id: string
  name: string
  description: string
  isAdmin: boolean
  builtIn: boolean
  userCount: number
  permissions: Record<string, AreaPermission>
}

interface AuditEntry {
  id: number
  at: string
  userEmail: string
  method: string
  path: string
  status: number
}

const ACTIONS: Action[] = ['create', 'read', 'update', 'delete']
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

/** Admins only: who can sign in, what each role may do, and the change log. */
export function UsersView() {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: async () => (await api.get<{ data: User[] }>('/admin/users')).data })
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ data: Role[]; areas: AreaDef[] }>('/admin/roles'),
  })
  const resources = useQuery({ queryKey: ['resources', 'all'], queryFn: () => getAll<Resource>('/resources') })

  return (
    <>
      <div>
        <div className="eyebrow">Sign-in and permissions</div>
        <h1>Users &amp; roles</h1>
      </div>
      <UsersTable users={users.data ?? []} roles={roles.data?.data ?? []} resources={resources.data ?? []} />
      {roles.data && <RolesPanel roles={roles.data.data} areas={roles.data.areas} />}
      <AuditPanel />
    </>
  )
}

function UsersTable({ users, roles, resources }: { users: User[]; roles: Role[]; resources: Resource[] }) {
  const qc = useQueryClient()
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }))
  const resourceOptions = [{ value: '', label: '(none)' }, ...resources.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]

  const columns: Column<User>[] = [
    { key: 'name', label: 'Name', edit: 'text', view: (u) => u.name, value: (u) => u.name },
    { key: 'email', label: 'Work email', edit: 'text', view: (u) => u.email, value: (u) => u.email, placeholder: 'name@beamanconsulting.com' },
    { key: 'roleId', label: 'Role', edit: 'select', options: roleOptions, view: (u) => u.roleName, value: (u) => u.roleId },
    {
      key: 'resourceId', label: 'Logs time as', edit: 'select', options: resourceOptions,
      view: (u) => u.resourceName ?? <span className="sub">none</span>, value: (u) => u.resourceId ?? '',
    },
    {
      key: 'active', label: 'Can sign in', edit: 'checkbox', value: (u) => u.active,
      view: (u) => <span className={'chip' + (u.active ? ' bill' : '')}>{u.active ? 'Yes' : 'Off'}</span>,
    },
    {
      key: 'lastSignInAt', label: 'Last signed in', edit: 'readonly', value: (u) => u.lastSignInAt ?? '',
      view: (u) => (u.lastSignInAt ? when(u.lastSignInAt) : <span className="sub">never</span>),
    },
  ]

  async function save(d: Draft, u: User | null) {
    const email = text(d, 'email').toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter their work email (the one they sign in to Microsoft with).')
    if (!d.roleId) throw new Error('Pick a role.')
    const body = { email, name: text(d, 'name'), roleId: String(d.roleId), resourceId: String(d.resourceId || '') || null, active: !!d.active }
    if (u) await api.patch(`/admin/users/${u.id}`, body)
    else await api.post('/admin/users', body)
    await qc.invalidateQueries({ queryKey: ['admin'] })
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  const defaultRole = roles.find((r) => r.name === 'Employee') ?? roles[0]
  return (
    <EditableTable title="Users" addLabel="Add user"
      description="Add someone here before they first sign in with Microsoft; they're matched by email. Link them to the person they log time as so “own records only” roles work. Turn off “Can sign in” to remove access at once."
      columns={columns} rows={users} rowId={(u) => u.id} minWidth={900}
      newRow={() => ({ name: '', email: '', roleId: defaultRole?.id ?? '', resourceId: '', active: true })}
      onSave={save} />
  )
}

function RolesPanel({ roles, areas }: { roles: Role[]; areas: AreaDef[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const me = useMe()
  const [selected, setSelected] = useState(roles.find((r) => !r.isAdmin)?.id ?? roles[0]?.id ?? '')
  const role = roles.find((r) => r.id === selected) ?? roles[0]
  // Edits belong to one version of one role; picking another role or saving starts fresh.
  type Grid = Record<string, AreaPermission>
  const roleKey = role ? role.id + JSON.stringify(role.permissions) : ''
  const [edit, setEdit] = useState<{ key: string; grid: Grid }>({ key: roleKey, grid: role?.permissions ?? {} })
  const grid = edit.key === roleKey ? edit.grid : (role?.permissions ?? {})
  const setGrid = (next: Grid | ((g: Grid) => Grid)) => setEdit({ key: roleKey, grid: typeof next === 'function' ? next(grid) : next })
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  if (!role) return null

  const dirty = JSON.stringify(grid) !== JSON.stringify(role.permissions)
  const toggle = (area: string, key: keyof AreaPermission) =>
    setGrid((g) => ({ ...g, [area]: { ...g[area]!, [key]: !g[area]?.[key] } }))

  async function run(fn: () => Promise<unknown>, done: string) {
    setSaving(true)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['admin'] })
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast(done)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const addRole = () =>
    run(async () => {
      const name = newName.trim()
      if (!name) throw new Error('Name the new role.')
      const res = await api.post<{ data: Role }>('/admin/roles', { name, permissions: grid })
      setNewName('')
      setSelected(res.data.id)
    }, 'Role added (starting from the grid shown)')

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Roles</h2>
        <span className="spacer" />
        <label className="lbl">
          Role
          <select value={role.id} onChange={(e) => setSelected(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.userCount} {r.userCount === 1 ? 'user' : 'users'})</option>)}
          </select>
        </label>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <p className="note" style={{ marginTop: 0 }}>{role.description || '—'}</p>
        {role.isAdmin ? (
          <p className="note">Admins can do everything, including managing users and roles. {me.user.roleId === role.id && 'You have this role.'}</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Area</th>
                  {ACTIONS.map((a) => <th key={a} className="n" style={{ textTransform: 'capitalize' }}>{a}</th>)}
                  <th className="n">Own only</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {areas.map((area) => (
                  <tr key={area.key}>
                    <td>{area.label}</td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="n">
                        {area.actions.includes(a) ? (
                          <input type="checkbox" aria-label={`${area.label}: ${a}`} checked={!!grid[area.key]?.[a]} onChange={() => toggle(area.key, a)} />
                        ) : <span className="sub">—</span>}
                      </td>
                    ))}
                    <td className="n">
                      {area.ownOnly ? (
                        <input type="checkbox" aria-label={`${area.label}: own records only`} checked={!!grid[area.key]?.ownOnly} onChange={() => toggle(area.key, 'ownOnly')} />
                      ) : <span className="sub">—</span>}
                    </td>
                    <td><span className="sub">{area.note}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {!role.isAdmin && (
            <>
              <button className="btn primary" disabled={!dirty || saving}
                onClick={() => run(() => api.patch(`/admin/roles/${role.id}`, { permissions: grid }), `Saved ${role.name}`)}>
                Save {role.name}
              </button>
              <button className="btn quiet" disabled={!dirty || saving} onClick={() => setGrid(role.permissions)}>Undo changes</button>
            </>
          )}
          {!role.builtIn && (
            <button className="btn danger" disabled={saving || role.userCount > 0} title={role.userCount ? 'Move its users to another role first' : ''}
              onClick={() => confirm(`Delete the role ${role.name}?`) && run(async () => {
                await api.del(`/admin/roles/${role.id}`)
                setSelected(roles.find((r) => r.id !== role.id)?.id ?? '')
              }, 'Role deleted')}>
              Delete role
            </button>
          )}
          <span className="spacer" />
          <input placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New role name" />
          <button className="btn" disabled={saving} onClick={addRole}>Add role</button>
        </div>
        <p className="note">The server checks every request against these rights; hiding a page here is only for convenience. Lists used in drop-downs (projects, tasks, people, vehicles, employees, mileage rates) can be read by everyone signed in.</p>
      </div>
    </section>
  )
}

function AuditPanel() {
  const log = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => (await api.get<{ data: AuditEntry[] }>('/admin/audit?limit=100')).data,
  })
  return (
    <section className="panel">
      <div className="panel-h"><h2>Recent changes</h2><span className="note">The last 100 changes made in the app, including refused attempts.</span></div>
      <div className="scroll">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="n">Result</th></tr></thead>
          <tbody>
            {(log.data ?? []).length ? log.data!.map((e) => (
              <tr key={e.id}>
                <td className="num">{when(e.at)}</td>
                <td>{e.userEmail || <span className="sub">not signed in</span>}</td>
                <td><code>{e.method} {e.path.replace(/^\/api/, '')}</code></td>
                <td className="n"><span className={'chip' + (e.status < 400 ? ' bill' : '')}>{e.status < 400 ? 'OK' : e.status === 403 ? 'Refused' : e.status}</span></td>
              </tr>
            )) : <tr><td colSpan={4} className="empty">No changes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
