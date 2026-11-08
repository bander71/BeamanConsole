import { useState } from 'react'
import { ApiError } from '../../api/client.ts'
import { ACCOUNT_TYPES, type Account, type AccountInput, type AccountType } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { norm, today } from '../../lib/format.ts'
import { useAccountMutations } from './data.ts'

const FIELDS = ['name', 'phone', 'website', 'address', 'keywords', 'category', 'billingAttn', 'billingEmail', 'notes'] as const
type Field = (typeof FIELDS)[number]

/** Add or edit an account. Leave `account` out to create one. */
export function AccountForm({ account, accounts, onDone }: {
  account?: Account
  accounts: Account[]
  onDone: (saved?: Account) => void
}) {
  const toast = useToast()
  const { create, update } = useAccountMutations()
  const [v, setV] = useState<Record<Field, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f, account?.[f] ?? ''])) as Record<Field, string>)
  const [type, setType] = useState<AccountType | ''>(account?.type ?? '')
  const [aliases, setAliases] = useState((account?.aliases ?? []).join(', '))
  const saving = create.isPending || update.isPending

  const bind = (f: Field) => ({ value: v[f], onChange: (e: { target: { value: string } }) => setV({ ...v, [f]: e.target.value }) })

  async function save() {
    const name = v.name.trim()
    if (!name) return toast('Enter the account name.')

    // Same name matching as the prototype: names and aliases must point to one account.
    const clash = accounts.find((a) => a.id !== account?.id && [a.name, ...a.aliases].some((n) => norm(n) === norm(name)))
    if (clash) return toast(`${name} already links to ${clash.name}.`)

    let list = aliases.split(',').map((x) => x.trim()).filter(Boolean)
    // Renaming keeps the old name as an alias, so existing timesheets and trips still link here.
    if (account && norm(account.name) !== norm(name) && !list.some((x) => norm(x) === norm(account.name))) list.push(account.name)
    list = list.filter((x) => norm(x) !== norm(name))

    const body: AccountInput = {
      ...Object.fromEntries(FIELDS.map((f) => [f, v[f].trim()])),
      name,
      type: type || null,
      aliases: list,
    }
    try {
      const saved = account
        ? await update.mutateAsync({ id: account.id, ...body })
        : await create.mutateAsync({ ...body, source: 'Manual', dateAdded: today() })
      toast('Account saved')
      onDone(saved)
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? `An account named ${name} already exists.` : `Couldn't save the account. ${(e as Error).message}`)
    }
  }

  return (
    <>
      <div className="panel-h">
        <h2>{account ? 'Edit ' + account.name : 'New account'}</h2>
        <span className="spacer" />
        <button className="btn sm" onClick={() => onDone()} disabled={saving}>Cancel</button>
        <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <form className="tform" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="lbl wide">Name<input className="field" autoFocus {...bind('name')} /></label>
        <label className="lbl">Type
          <select value={type} onChange={(e) => setType(e.target.value as AccountType | '')}>
            <option value="">Not set</option>
            {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="lbl">Phone<input className="field" {...bind('phone')} /></label>
        <label className="lbl">Website<input className="field" {...bind('website')} /></label>
        <label className="lbl wide">Address<input className="field" {...bind('address')} /></label>
        <label className="lbl">Keywords<input className="field" {...bind('keywords')} /></label>
        <label className="lbl">Category<input className="field" {...bind('category')} /></label>
        <label className="lbl">Billing contact (Attn)<input className="field" placeholder="Accounts Payable" {...bind('billingAttn')} /></label>
        <label className="lbl">Billing email<input className="field" type="email" {...bind('billingEmail')} /></label>
        <label className="lbl full">Other names that should link here (comma separated)
          <input className="field" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="McElroys, McElroys IT" />
        </label>
        <label className="lbl full">Notes<textarea className="field" rows={4} {...bind('notes')} /></label>
        <button type="submit" hidden />
      </form>
    </>
  )
}
