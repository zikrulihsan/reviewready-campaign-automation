import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not configured')

export const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
  connect_timeout: 12,
  idle_timeout: 60,
})

export const q: any = (strings: TemplateStringsArray, ...values: any[]) => {
  const run = () => sql(strings, ...values)
  return run().catch((error: any) => {
    if (error?.code === 'CONNECT_TIMEOUT') return run()
    throw error
  })
}
export const json = (value: unknown) => sql.json(value as any)
export const table = 'reviewready'
