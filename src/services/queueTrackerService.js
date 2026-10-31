import { supabase } from '../lib/supabase'

export async function getLiveQueueBooking(bookingId, userId) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select(`
      id, booking_id, queue_number, status, estimated_wait_minutes, estimated_start_at,
      service_started_at, completed_at, created_at, customer_id,
      customer_name_snapshot, customer_phone_snapshot,
      booking:bookings(
        booking_number, booking_type, status, scheduled_start, actual_start, actual_end,
        salon:salons(id, name, city, timezone),
        booking_items(service_name_snapshot, duration_minutes),
        booking_staff(start_at, end_at, employee:employees(employee_name))
      )
    `)
    .eq('booking_id', bookingId)
    .eq('customer_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export function subscribeToQueueBooking(bookingId, onChange) {
  const channel = supabase
    .channel(`queue-tracker-${bookingId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `booking_id=eq.${bookingId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export function getRemainingMinutes(estimatedStartAt) {
  if (!estimatedStartAt) return null
  return Math.max(0, Math.ceil((new Date(estimatedStartAt).getTime() - Date.now()) / 60000))
}

export function getProgressPercent(entry) {
  const wait = Number(entry?.estimated_wait_minutes)
  if (!Number.isFinite(wait) || wait <= 0 || !entry?.estimated_start_at) return wait === 0 ? 100 : 0
  return Math.min(100, Math.max(0, ((wait - getRemainingMinutes(entry.estimated_start_at)) / wait) * 100))
}
