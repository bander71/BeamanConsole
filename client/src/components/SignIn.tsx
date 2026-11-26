import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { MeContext, type Me, SIGNED_OUT_EVENT, type SignInOptions } from '../api/auth.ts'
import { api, ApiError } from '../api/client.ts'
import '../styles/auth.css'

const SIGN_IN_ERRORS: Record<string, string> = {
  not_added: "Your Microsoft account isn't set up in the Beaman Console yet. Ask an admin to add your email under Users.",
  inactive: 'Your access to the Beaman Console has been turned off. Ask an admin if this is a mistake.',
  wrong_tenant: 'Sign in with your Beaman Consulting work account.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'Sign-in took too long. Please try again.',
  failed: "Sign-in with Microsoft didn't work. Please try again.",
}

/** Shows the app only when someone is signed in; otherwise the sign-in page. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ data: Me }>('/auth/me')).data,
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    const onSignedOut = () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
      qc.invalidateQueries({ queryKey: ['me'] })
    }
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [qc])

  if (me.data) return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>
  if (me.isPending) return <div className="signin"><p className="note">Loading…</p></div>
  if (me.error instanceof ApiError && me.error.status === 401) return <SignInPage />
  return (
    <div className="signin">
      <div className="signin-card panel">
        <h1>Beaman Console</h1>
        <p>{me.error?.message ?? "Can't reach the server."}</p>
        <button className="btn" onClick={() => me.refetch()}>Try again</button>
      </div>
    </div>
  )
}

interface DevUser {
  id: string
  email: string
  name: string
  roleName: string
}

function SignInPage() {
  const qc = useQueryClient()
  const options = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: async () => (await api.get<{ data: SignInOptions }>('/auth/options')).data,
  })
  const urlError = new URLSearchParams(window.location.search).get('signin_error')
  const [error, setError] = useState(urlError ? SIGN_IN_ERRORS[urlError] ?? SIGN_IN_ERRORS.failed : '')
  const returnTo = window.location.pathname === '/' ? '/' : window.location.pathname + window.location.search

  const signedIn = () => {
    window.history.replaceState(null, '', returnTo.includes('signin_error') ? '/' : returnTo)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    return qc.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <div className="signin">
      <div className="signin-card panel">
        <div className="signin-brand"><b>Beaman</b> <span>Console</span></div>
        <h1>Sign in</h1>
        {error && <p className="signin-error" role="alert">{error}</p>}

        {options.data?.microsoft && (
          <a className="btn primary signin-ms" href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in with Microsoft
          </a>
        )}
        {options.data && !options.data.microsoft && !options.data.dev && (
          <p className="note">Sign-in isn't set up on this server yet. See the "Sign-in" section of server/README.md.</p>
        )}
        {options.data?.dev && <DevSignIn onSignedIn={signedIn} onError={setError} />}
      </div>
    </div>
  )
}

/** Development only: sign in as any user, or make the first admin. Never offered on Azure. */
function DevSignIn({ onSignedIn, onError }: { onSignedIn: () => void; onError: (msg: string) => void }) {
  const users = useQuery({
    queryKey: ['auth', 'devUsers'],
    queryFn: () => api.get<{ data: DevUser[]; needsFirstAdmin: boolean }>('/auth/dev/users'),
  })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  async function login(body: unknown) {
    try {
      await api.post('/auth/dev/login', body)
      onSignedIn()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  function firstAdmin(e: FormEvent) {
    e.preventDefault()
    void login({ email: email.trim(), name: name.trim() })
  }

  return (
    <div className="signin-dev">
      <div className="eyebrow">Development sign-in (this computer only)</div>
      {users.data?.needsFirstAdmin ? (
        <form onSubmit={firstAdmin} className="signin-form">
          <p className="note">There are no users yet. Make yourself the first admin. Use your work email so Microsoft sign-in finds you later.</p>
          <label>Name <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label>Work email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <button className="btn primary" type="submit">Create admin and sign in</button>
        </form>
      ) : (
        <ul className="signin-users">
          {(users.data?.data ?? []).map((u) => (
            <li key={u.id}>
              <button className="btn" onClick={() => login({ userId: u.id })}>
                {u.name || u.email}
                <span className="chip">{u.roleName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
