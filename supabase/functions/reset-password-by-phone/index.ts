import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hashCode(phone: string, otp: string, secret: string) {
  const value = new TextEncoder().encode(`${secret}:${phone}:${otp}`)
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Password reset function is missing Supabase server configuration.')
    return json({ error: 'Password reset is temporarily unavailable.' }, 500)
  }

  try {
    const body = await request.json()
    const { action, phone, otp, newPassword } = body
    if (typeof phone !== 'string' || !/^\+91[6-9]\d{9}$/.test(phone)) {
      return json({ error: 'Enter a valid 10-digit Indian mobile number.' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const phoneDigits = phone.slice(3)
    const email = `phone-${phoneDigits}@booksaloon.app`
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (profileError) throw profileError

    if (action === 'request') {
      if (!profile) return json({ accepted: true })
      const { data: previous, error: previousError } = await admin
        .from('password_reset_otps')
        .select('created_at')
        .eq('phone', phone)
        .maybeSingle()
      if (previousError) throw previousError
      if (previous && Date.now() - new Date(previous.created_at).getTime() < 30000) {
        return json({ error: 'Please wait before requesting another OTP.' }, 429)
      }

      const randomValue = new Uint32Array(1)
      crypto.getRandomValues(randomValue)
      const demoOtp = String(randomValue[0] % 10000).padStart(4, '0')
      const { error: saveError } = await admin.from('password_reset_otps').upsert({
        phone,
        code_hash: await hashCode(phone, demoOtp, serviceRoleKey),
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        attempt_count: 0,
        consumed_at: null,
      })
      if (saveError) throw saveError
      return json({ accepted: true, demoOtp })
    }

    if (action === 'reset') {
      if (!profile) return json({ error: 'The OTP is invalid or expired.' }, 400)
      if (typeof otp !== 'string' || !/^\d{4}$/.test(otp)) {
        return json({ error: 'Enter the 4-digit OTP.' }, 400)
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return json({ error: 'Password must be at least 6 characters long.' }, 400)
      }

      const { data: consumed, error: consumeError } = await admin.rpc('consume_password_reset_otp', {
        p_phone: phone,
        p_code_hash: await hashCode(phone, otp, serviceRoleKey),
      })
      if (consumeError) throw consumeError
      if (!consumed) return json({ error: 'The OTP is invalid or expired.' }, 400)

      const { error: passwordError } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword })
      if (passwordError) throw passwordError
      return json({ success: true })
    }

    return json({ error: 'Unsupported password reset action.' }, 400)
  } catch (error) {
    console.error('Password reset request failed:', error)
    return json({ error: 'Unable to reset the password right now. Please try again.' }, 500)
  }
})
