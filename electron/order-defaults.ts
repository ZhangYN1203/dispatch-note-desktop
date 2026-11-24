import { queryOne, run } from './database'

const fields = ['sender', 'senderPhone', 'warehouse', 'maker'] as const
export type OrderDefaults = Partial<Record<typeof fields[number], string>>
export function getOrderDefaults(): OrderDefaults {
  const value = queryOne("SELECT value FROM settings WHERE key='orderDefaults'")?.value
  if (!value) return {}
  return validate(JSON.parse(value))
}
function validate(input: Record<string, unknown>): OrderDefaults {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('默认值格式错误')
  for (const [key, value] of Object.entries(input)) {
    if (!fields.includes(key as typeof fields[number]) || typeof value !== 'string' || value.length > 200) throw new Error('默认值包含无效字段或内容过长')
  }
  return input as OrderDefaults
}
export function saveOrderDefaults(input: Record<string, unknown>): void {
  run("INSERT OR REPLACE INTO settings (key,value) VALUES ('orderDefaults',?)", [JSON.stringify(validate(input))])
}
