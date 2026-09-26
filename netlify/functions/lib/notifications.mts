import { q } from './db.mts'
import nodemailer from 'nodemailer'

type Channel = 'email' | 'slack'

export function appLink(path: string) {
  const origin = process.env.PUBLIC_APP_URL || process.env.URL || 'http://localhost:8888'
  return new URL(path, origin).toString()
}

export async function queueNotification(tx: any, item: {
  sourceKey: string; campaignId: string; channel: Channel; kind: string;
  recipient: string; subject: string; body: string
}) {
  await tx`INSERT INTO reviewready.notification_deliveries
    (id,source_key,campaign_id,channel,notification_kind,recipient,subject,body)
    VALUES (${crypto.randomUUID()},${item.sourceKey},${item.campaignId},${item.channel},${item.kind},${item.recipient},${item.subject},${item.body})
    ON CONFLICT (source_key) DO NOTHING`
}

async function send(row: any) {
  if (row.channel === 'slack') {
    const webhook = process.env.SLACK_REVIEWER_WEBHOOK_URL
    if (!webhook) throw new Error('Slack reviewer webhook is not configured')
    const response = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: row.body }), signal: AbortSignal.timeout(5000),
    })
    if (!response.ok || (await response.text()).trim() !== 'ok') throw new Error(`Slack delivery failed (${response.status})`)
    return null
  }
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASSWORD
  const sender = process.env.NOTIFICATION_FROM_EMAIL
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !sender) {
    throw new Error('Creator SMTP delivery is not configured')
  }
  const transporter = nodemailer.createTransport({
    host, port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user, pass: password },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  })
  try {
    const info = await transporter.sendMail({
      from: sender, to: row.recipient, subject: row.subject, text: row.body,
      headers: { 'X-ReviewReady-Notification-ID': row.source_key },
    })
    return info.messageId || null
  } finally {
    transporter.close()
  }
}

export async function deliverPendingNotifications(limit = 3, campaignId?: string) {
  const results: { source_key: string; status: string }[] = []
  for (let i = 0; i < limit; i++) {
    const claimed = await q`UPDATE reviewready.notification_deliveries AS n
      SET delivery_status='processing', attempts=n.attempts+1,
          next_attempt_at=now()+interval '2 minutes', last_error=NULL
      FROM (
        SELECT id FROM reviewready.notification_deliveries
        WHERE (delivery_status IN ('pending','failed') AND next_attempt_at <= now()
          OR delivery_status='processing' AND next_attempt_at <= now())
          AND (${campaignId || null}::text IS NULL OR campaign_id=${campaignId || null})
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
      ) AS due
      WHERE n.id=due.id RETURNING n.*`
    if (!claimed.length) break
    const row = claimed[0]
    try {
      const providerId = await send(row)
      await q`UPDATE reviewready.notification_deliveries
        SET delivery_status='sent', provider_id=${providerId}, sent_at=now(), last_error=NULL
        WHERE id=${row.id}`
      results.push({ source_key: row.source_key, status: 'sent' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown delivery error'
      const retryMinutes = Math.min(60, 2 ** Math.min(row.attempts, 6))
      await q`UPDATE reviewready.notification_deliveries
        SET delivery_status='failed', last_error=${message.slice(0, 300)},
            next_attempt_at=now()+make_interval(mins=>${retryMinutes})
        WHERE id=${row.id}`
      results.push({ source_key: row.source_key, status: 'failed' })
    }
  }
  return results
}
