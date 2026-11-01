import { createClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function isValidSupabaseUrl(value) {
  if (!value) return false
  try {
    const parsedUrl = new URL(value)
    return parsedUrl.protocol === 'https:' && parsedUrl.hostname.length > 0
  } catch {
    return false
  }
}

const url = isValidSupabaseUrl(configuredUrl) ? configuredUrl : 'https://demo-project.supabase.co'
const anonKey = configuredAnonKey || 'demo-anon-key'

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export const isSupabaseConfigured = Boolean(
  isValidSupabaseUrl(configuredUrl) && configuredAnonKey,
)
