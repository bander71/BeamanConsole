import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client.ts'
import type { Employee } from '../../api/types.ts'
import { EditableTable, type Column } from '../../components/EditableTable.tsx'
import { text, type Draft } from '../../components/editable.ts'
import { fm, today } from '../../lib/format.ts'
import { isOpen, STAGE_PROBABILITY } from '../../lib/stages.ts'
import { employeeName, useEmployees, useOpportunities } from '../pipeline/data.ts'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Your team, and the pipeline by sales rep, as in the prototype. */
export function EmployeesView() {
  const qc = useQueryClient()
  const employees = useEmployees().data ?? []
  const opps = useOpportunities().data ?? []
  const [yr] = useState(() => today().slice(0, 4))

  const sorted = [...employees].sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName))

  const columns: Column<Employee>[] = [
    { key: 'firstName', label: 'First name', edit: 'text', view: (e) => e.firstName, value: (e) => e.firstName },
    { key: 'lastName', label: 'Last name', edit: 'text', view: (e) => e.lastName, value: (e) => e.lastName },
    { key: 'email', label: 'Email', edit: 'text', view: (e) => e.email ?? '', value: (e) => e.email ?? '' },
    { key: 'phone', label: 'Phone', edit: 'text', view: (e) => e.phone, value: (e) => e.phone },
    { key: 'title', label: 'Title', edit: 'text', view: (e) => e.title, value: (e) => e.title },
    {
      key: 'active', label: 'Active', edit: 'checkbox', value: (e) => e.active,
      view: (e) => <span className={'chip' + (e.active ? ' bill' : '')}>{e.active ? 'Active' : 'Inactive'}</span>,
    },
  ]

  async function save(d: Draft, e: Employee | null) {
    const firstName = text(d, 'firstName'), lastName = text(d, 'lastName'), email = text(d, 'email')
    if (!firstName && !lastName) throw new Error('Enter a first or last name.')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Check the email address.')
    const dup = employees.find((x) => x.id !== e?.id && `${x.firstName} ${x.lastName}`.toLowerCase() === `${firstName} ${lastName}`.toLowerCase())
    if (dup) throw new Error(`${firstName} ${lastName} is already an employee.`)
    // The database needs a first name; someone entered by last name only keeps it there.
    const body = { firstName: firstName || lastName, lastName: firstName ? lastName : '', email: email || null, phone: text(d, 'phone'), title: text(d, 'title'), active: !!d.active }
    if (e) await api.patch(`/employees/${e.id}`, body)
    else await api.post('/employees', body)
    qc.invalidateQueries({ queryKey: ['employees'] })
  }

  const open = opps.filter((o) => isOpen(o.stage))

  return (
    <>
      <div>
        <div className="eyebrow">Your team</div>
        <h1>Employees</h1>
      </div>

      <EditableTable title="Employees" addLabel="Add employee" description="Employees can be assigned as the sales rep on opportunities."
        columns={columns} rows={sorted} rowId={(e) => e.id}
        newRow={() => ({ firstName: '', lastName: '', email: '', phone: '', title: '', active: true })}
        onSave={save} />

      <section className="panel">
        <div className="panel-h"><h2>Pipeline by sales rep</h2></div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Sales rep</th><th className="n">Open deals</th><th className="n">Open value</th><th className="n">Weighted</th>
                <th className="n">Won {yr}</th><th className="n">Won value {yr}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length ? sorted.map((e) => {
                const mine = open.filter((o) => o.repId === e.id)
                const won = opps.filter((o) => o.repId === e.id && o.stage === 'Won' && (o.wonAt ?? o.targetClose ?? '').startsWith(yr))
                return (
                  <tr key={e.id}>
                    <td>{employeeName(e)}<span className="sub">{e.title || e.email || ''}</span></td>
                    <td className="n num">{mine.length}</td>
                    <td className="n num">{fm(sum(mine.map((o) => o.value)))}</td>
                    <td className="n num">{fm(sum(mine.map((o) => o.value * STAGE_PROBABILITY[o.stage])))}</td>
                    <td className="n num">{won.length}</td>
                    <td className="n num">{fm(sum(won.map((o) => o.value)))}</td>
                  </tr>
                )
              }) : <tr><td colSpan={6} className="empty">Add an employee above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
