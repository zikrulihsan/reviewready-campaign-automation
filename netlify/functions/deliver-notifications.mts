import type { Config } from '@netlify/functions'
import { deliverPendingNotifications } from './lib/notifications.mts'

export default async () => {
  await deliverPendingNotifications(3)
}

export const config: Config = { schedule: '* * * * *' }
