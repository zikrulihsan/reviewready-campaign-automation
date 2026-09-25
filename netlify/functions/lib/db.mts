import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not configured')

export const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
  connect_timeout: 10,
  idle_timeout: 20,
})

export const q: any = sql
export const json = (value: unknown) => sql.json(value as any)
export const table = 'reviewready'
