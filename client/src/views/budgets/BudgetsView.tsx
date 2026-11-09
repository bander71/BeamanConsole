import { Fragment } from 'react'
import { fh2, fm, pct, shortDate } from '../../lib/format.ts'
import { useBudgets, type BudgetTask } from './data.ts'

/** Hours, or a dash when there's no budget (as the prototype shows). */
const orDash = (show: boolean, text: string) => (show ? text : '—')

function Burn({ t }: { t: BudgetTask }) {
  if (!t.budgetHours) return <span className="note">No budget</span>
  const r = t.burn ?? 0
  const cls = r > 1 ? 'over' : r > 0.8 ? 'hi' : ''
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <div className={`burn ${cls}`} style={{ flex: 1 }}>
        <i style={{ width: `${Math.min(100, r * 100)}%` }} />
      </div>
      <span className="num" style={{ fontSize: 12, width: 38, textAlign: 'right' }}>
        {pct(r)}
      </span>
    </div>
  )
}

/** Read-only budget vs actual hours, value, cost and margin per project and task. */
export function BudgetsView() {
  const q = useBudgets()
  const projects = q.data ?? []

  return (
    <>
      <div>
        <div className="eyebrow">Hours against plan</div>
        <h1>Project budgets</h1>
      </div>
      <p className="note">
        Actual hours include every timesheet line, at any status. Value for T&amp;M tasks is actual hours × bill rate. For Flat Fee tasks it is the
        fixed contract value (budgeted hours × bill rate), so overruns show up as lower margin. Cost is actual hours × 1099 rate.
      </p>
      <section className="panel">
        <div className="scroll">
          <table style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Resource</th>
                <th>Type</th>
                <th className="n">Bill rate</th>
                <th className="n">Budget h</th>
                <th className="n">Actual h</th>
                <th className="n">Remaining</th>
                <th style={{ width: 150 }}>Burn</th>
                <th className="n">Value</th>
                <th className="n">Cost</th>
                <th className="n">Margin</th>
              </tr>
            </thead>
            <tbody>
              {q.isPending && (
                <tr>
                  <td colSpan={11} className="note">
                    Loading…
                  </td>
                </tr>
              )}
              {q.isError && (
                <tr>
                  <td colSpan={11} className="note">
                    Couldn't load budgets: {q.error.message}
                  </td>
                </tr>
              )}
              {q.isSuccess && !projects.length && (
                <tr>
                  <td colSpan={11} className="note">
                    No tasks yet. Add projects and tasks in Setup.
                  </td>
                </tr>
              )}
              {projects.map((p) => {
                const T = p.totals
                const money = (n: number | null) => (p.internal ? '—' : fm(n))
                return (
                  <Fragment key={p.projectId}>
                    <tr className="grp">
                      <td colSpan={4}>
                        {p.name}{' '}
                        <span className="sub">
                          {p.code} · {p.type ?? ''}
                          {p.startDate && ` · started ${shortDate(p.startDate)}`}
                          {p.endDate && ` · ends ${shortDate(p.endDate)}`}
                        </span>
                      </td>
                      <td className="n num">{orDash(!!T.budgetHours, fh2(T.budgetHours))}</td>
                      <td className="n num">{fh2(T.actualHours)}</td>
                      <td className="n num">{orDash(!!T.budgetHours, fh2(T.remainingHours))}</td>
                      <td>{T.budgetHours ? `${pct(T.burn)} used` : ''}</td>
                      <td className="n num">{money(T.value)}</td>
                      <td className="n num">{money(T.cost)}</td>
                      <td className="n num">{money(T.margin)}</td>
                    </tr>
                    {p.tasks.map((t) => (
                      <tr key={t.taskId}>
                        <td>
                          {t.name}
                          <span className="sub">
                            #{t.taskNumber} · {p.accountName ?? ''}
                          </span>
                        </td>
                        <td>{t.resourceName}</td>
                        <td>
                          <span className="chip">{t.type || p.type || ''}</span>
                        </td>
                        <td className="n num">{t.billRate ? fm(t.billRate) : '—'}</td>
                        <td className="n num">{orDash(!!t.budgetHours, fh2(t.budgetHours))}</td>
                        <td className="n num">{fh2(t.actualHours)}</td>
                        <td className={`n num${t.budgetHours && t.actualHours > t.budgetHours ? ' over' : ''}`}>
                          {orDash(!!t.budgetHours, fh2(t.remainingHours))}
                        </td>
                        <td>
                          <Burn t={t} />
                        </td>
                        <td className="n num">{money(t.value)}</td>
                        <td className="n num">{money(t.cost)}</td>
                        <td className="n num">{money(t.margin)}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
