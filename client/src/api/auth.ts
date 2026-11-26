// The signed-in user and what their role allows. The server checks every request;
// these are only for showing the right screens and buttons.

import { createContext, useContext } from 'react'

export type Action = 'create' | 'read' | 'update' | 'delete'

export interface AreaPermission {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
  ownOnly: boolean
}

export interface AreaDef {
  key: string
  label: string
  actions: Action[]
  ownOnly?: boolean
  note?: string
}

export interface Me {
  user: { id: string; email: string; name: string; roleId: string; roleName: string; resourceId: string | null }
  permissions: { isAdmin: boolean; areas: Record<string, AreaPermission> }
  areas: AreaDef[]
}

export interface SignInOptions {
  microsoft: boolean
  dev: boolean
}

export const MeContext = createContext<Me | null>(null)

export function useMe(): Me {
  const me = useContext(MeContext)
  if (!me) throw new Error('useMe outside the signed-in app')
  return me
}

export function canDo(me: Me, area: string, action: Action): boolean {
  return me.permissions.isAdmin || !!me.permissions.areas[area]?.[action]
}

/** can('invoices', 'update') */
export function useCan() {
  const me = useMe()
  return (area: string, action: Action) => canDo(me, area, action)
}

/** Fired by the API client when the server says the session is gone. */
export const SIGNED_OUT_EVENT = 'beaman:signed-out'
