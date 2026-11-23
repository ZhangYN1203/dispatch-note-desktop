import { queryAll, queryOne, run, withTransaction } from './database'

export const inventoryStores = ['workshops', 'materials', 'material_inbound', 'material_outbound',
  'suppliers', 'productions', 'production_materials', 'finished_products', 'finished_product_logs', 'stock_logs']

function checkStore(store: string) {
  if (!inventoryStores.includes(store)) throw new Error('无效的库存数据类型')
}

export function listInventory(store: string): Record<string, any>[] {
  checkStore(store)
  return queryAll('SELECT data FROM production_records WHERE store = ? ORDER BY id', [store]).map(row => JSON.parse(row.data))
}

export function putInventory(store: string, data: Record<string, any>, insertOnly = false): number {
  checkStore(store)
  return withTransaction(() => {
    const sequenceKey = 'inventorySequence:' + store
    const sequence = Number(queryOne('SELECT value FROM settings WHERE key = ?', [sequenceKey])?.value || 0)
    const highest = queryOne('SELECT MAX(id) AS id FROM production_records WHERE store = ?', [store])?.id || 0
    const id = data.id ?? (Math.max(sequence, highest) + 1)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('库存记录编号无效')
    run(`${insertOnly ? 'INSERT' : 'INSERT OR REPLACE'} INTO production_records (store,id,data) VALUES (?,?,?)`,
      [store, id, JSON.stringify({ ...data, id })])
    run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [sequenceKey, String(Math.max(sequence, id))])
    return id
  })
}

export function deleteInventory(store: string, id: number): void {
  checkStore(store)
  run('DELETE FROM production_records WHERE store = ? AND id = ?', [store, id])
}

export function inventoryMigrated(): boolean {
  return queryOne("SELECT value FROM settings WHERE key = 'inventoryMigrated'")?.value === '1'
}

export function migrateInventory(stores: Record<string, Record<string, any>[]>): void {
  if (inventoryMigrated()) return
  withTransaction(() => {
    for (const [store, rows] of Object.entries(stores)) {
      checkStore(store)
      if (!Array.isArray(rows)) throw new Error('库存迁移数据格式错误')
      for (const data of rows) putInventory(store, data, true)
    }
    // Deleted legacy objects may still be referenced by historical logs.
    const references: Record<string, string> = { material_id: 'materials', supplier_id: 'suppliers',
      workshop_id: 'workshops', production_id: 'productions', product_id: 'finished_products' }
    const reserveId = (store: string, id: number) => {
      if (!Number.isSafeInteger(id) || id <= 0) return
      const key = 'inventorySequence:' + store
      const previous = Number(queryOne('SELECT value FROM settings WHERE key=?', [key])?.value || 0)
      if (id > previous) run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, String(id)])
    }
    for (const [store, rows] of Object.entries(stores)) {
      for (const row of rows) {
        for (const [field, target] of Object.entries(references)) reserveId(target, row[field])
        if (store === 'stock_logs') reserveId(row.stock_type === 'material' ? 'materials' : 'finished_products', row.item_id)
      }
    }
    run("INSERT OR REPLACE INTO settings (key,value) VALUES ('inventoryMigrated','1')")
  })
}
