import { supabase } from './supabase'

const ADMIN_SESSION_KEY = 'booksaloon_admin_session'

export async function issueAdminSession() {
  const { data, error } = await supabase.rpc('issue_admin_session', {
    p_user_agent: navigator.userAgent,
  })

  if (error) {
    throw new Error(error.message)
  }

  sessionStorage.setItem(ADMIN_SESSION_KEY, data)
  return data
}

export async function validateAdminSession() {
  const sessionId = sessionStorage.getItem(ADMIN_SESSION_KEY)
  if (!sessionId) {
    return false
  }

  const { data, error } = await supabase.rpc('validate_admin_session', {
    p_session_id: sessionId,
  })

  if (error || !data) {
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    return false
  }

  return true
}

export async function revokeAdminSession() {
  const sessionId = sessionStorage.getItem(ADMIN_SESSION_KEY)
  sessionStorage.removeItem(ADMIN_SESSION_KEY)

  if (sessionId) {
    await supabase.rpc('revoke_admin_session', { p_session_id: sessionId })
  }
}
