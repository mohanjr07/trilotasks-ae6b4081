import { corsHeaders } from '@supabase/supabase-js/cors'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend'

interface NotificationPayload {
  id: string
  user_id: string
  title: string
  body: string
  type: string | null
  reference_id: string | null
}

function buildEmailHtml(notification: NotificationPayload, userName: string, userEmail: string): { subject: string; html: string } {
  const type = notification.type || 'general'
  let subject = notification.title
  let ctaText = 'Open TaskFlow'
  let ctaUrl = 'https://trilotasks.lovable.app'

  if (type === 'task') {
    subject = `TaskFlow: ${notification.title}`
    ctaText = 'View Task'
    ctaUrl = 'https://trilotasks.lovable.app/tasks'
  } else if (type === 'leave') {
    subject = `TaskFlow: ${notification.title}`
    ctaText = 'View Details'
    ctaUrl = 'https://trilotasks.lovable.app/leave'
  } else if (type === 'meeting') {
    subject = `TaskFlow: ${notification.title}`
    ctaText = 'View Meeting'
    ctaUrl = 'https://trilotasks.lovable.app/teams'
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 40px; text-align: center;">
            <h1 style="color:#ffffff;font-size:24px;margin:0;font-weight:700;">TaskFlow</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="color:#374151;font-size:16px;margin:0 0 8px;">Hi <strong>${userName}</strong>,</p>
            <h2 style="color:#111827;font-size:20px;margin:16px 0 8px;">${notification.title}</h2>
            <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 28px;">${notification.body}</p>
            <table cellpadding="0" cellspacing="0"><tr><td>
              <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                ${ctaText}
              </a>
            </td></tr></table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">This is an automated notification from TaskFlow.<br/>You received this because you have an account on TaskFlow.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured')

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const payload = await req.json()

    // Support both direct call and pg_net trigger (record field)
    const notification: NotificationPayload = payload.record || payload

    if (!notification.user_id || !notification.title) {
      return new Response(JSON.stringify({ error: 'Invalid notification payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', notification.user_id)
      .single()

    if (profileError || !profile?.email) {
      console.error('Could not fetch user profile:', profileError)
      return new Response(JSON.stringify({ error: 'User profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { subject, html } = buildEmailHtml(notification, profile.full_name, profile.email)

    // Send email via Resend gateway
    const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: 'TaskFlow <onboarding@resend.dev>',
        to: [profile.email],
        subject,
        html,
      }),
    })

    const emailResult = await emailResponse.json()

    if (!emailResponse.ok) {
      console.error('Resend API error:', emailResult)
      // Update email_sent = false but don't throw
      await supabase
        .from('notifications')
        .update({ email_sent: false })
        .eq('id', notification.id)

      return new Response(JSON.stringify({ success: false, error: emailResult }), {
        status: 200, // Return 200 to not break trigger flow
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Mark email as sent
    await supabase
      .from('notifications')
      .update({ email_sent: true })
      .eq('id', notification.id)

    console.log(`Email sent to ${profile.email} for notification ${notification.id}`)

    return new Response(JSON.stringify({ success: true, emailId: emailResult.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Email notification error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 200, // Return 200 to not break trigger flow
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
