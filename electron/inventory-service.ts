import { createHash } from 'crypto'
import { queryOne, queryAll, run, withTransaction } from './database'
import { putInventory, deleteInventory } from './inventory'

export function getEntity(store: string, id: number): Record<string, any> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('记录编号无效')
  const row = queryOne('SELECT data FROM production_records WHERE store=? AND id=?', [store, id])
  if (!row) throw new Error('库存或关联记录不存在，请刷新后重试')
  return JSON.parse(row.data)
}
function positive(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1e9) throw new Error('数量必须是大于零的有效数值')
  return value
}
const now = () => new Date().toISOString()
const rounded = (value: number) => Math.round(value * 1e6) / 1e6

export function changeStock(store: 'materials' | 'finished_products', id: number, delta: number, type: string, meta: Record<string, any> = {}) {
  return withTransaction(() => {
  const item = getEntity(store, id)
  if (!Number.isFinite(item.quantity) || !Number.isFinite(delta)) throw new Error('库存数值无效，请先核对')
  const after = rounded(item.quantity + delta)
  if (after < 0) throw new Error(`库存不足：${item.name || item.product_name}，当前 ${item.quantity}`)
  putInventory(store, { ...item, quantity: after, updated_at: now() })
  putInventory('stock_logs', { stock_type: store === 'materials' ? 'material' : 'finished_product', item_id: id,
    item_name: item.name || item.product_name, change_type: type, quantity: delta,
    before_quantity: item.quantity, after_quantity: after, operator: meta.operator || '操作员', remark: meta.remark || '',
    order_id: meta.orderId || 0, created_at: now() }, true)
  if (store === 'finished_products' && item.production_id) {
    const task = queryOne("SELECT data FROM production_records WHERE store='productions' AND id=?", [item.production_id])
    if (task) {
      const production = JSON.parse(task.data)
      if (['warehoused','shipped'].includes(production.status)) putInventory('productions', { ...production, status: after === 0 ? 'shipped' : 'warehoused', updated_at: now() })
    }
  }
  return item
  })
}

export function saveInventoryEntity(store: string, input: Record<string, any>, insertOnly = false): number {
  if (!['materials', 'suppliers', 'workshops', 'productions'].includes(store)) throw new Error('库存流水必须通过业务操作写入')
  return withTransaction(() => {
    const previous = input.id ? getEntity(store, input.id) : null
    if (store === 'materials') {
      if (!input.name?.trim()) throw new Error('原材料名称不能为空')
      if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error('库存数量无效')
      if (previous && input.quantity !== previous.quantity) throw new Error('不能直接覆盖库存，请通过入库或出库调整')
    }
    if (store === 'productions' && (previous || input.status !== 'pending')) throw new Error('生产状态请通过开始、完成或入库操作修改')
    const id = putInventory(store, input, insertOnly)
    if (store === 'materials' && !previous && input.quantity > 0) {
      putInventory('stock_logs', { stock_type: 'material', item_id: id, item_name: input.name, change_type: 'opening', quantity: input.quantity,
        before_quantity: 0, after_quantity: input.quantity, operator: '操作员', remark: '期初库存', created_at: now() }, true)
    }
    return id
  })
}

export function removeInventoryEntity(store: string, id: number): void {
  if (!['materials', 'suppliers', 'workshops'].includes(store)) throw new Error('此记录不允许直接删除')
  const item = getEntity(store, id)
  if (store === 'materials' && item.quantity !== 0) throw new Error('有库存的原材料不能删除')
  const field = { materials: 'material_id', suppliers: 'supplier_id', workshops: 'workshop_id' }[store]!
  const referenced = queryAll('SELECT store,data FROM production_records').some(row => {
    const data = JSON.parse(row.data)
    return data[field] === id || (store === 'materials' && row.store === 'stock_logs' && data.stock_type === 'material' && data.item_id === id)
  })
  if (referenced) throw new Error('此记录已有历史关联，不能删除')
  deleteInventory(store, id)
}

export function executeInventoryOperation(kind: string, data: Record<string, any>, requestId: string): Record<string, any> {
  if (typeof requestId !== 'string' || !requestId || requestId.length > 100) throw new Error('业务请求编号无效')
  const signature = createHash('sha256').update(JSON.stringify([kind, data])).digest('hex')
  return withTransaction(() => {
    const previous = queryOne('SELECT * FROM inventory_requests WHERE id=?', [requestId])
    if (previous) {
      if (previous.signature !== signature) throw new Error('重复请求的内容不同')
      return JSON.parse(previous.result)
    }
    let result: Record<string, any> = { success: true }
    const stamp = now()
    if (kind === 'material.inbound' || kind === 'material.outbound') {
      const quantity = positive(data.quantity)
      const outbound = kind === 'material.outbound'
      const material = getEntity('materials', data.materialId)
      const workshop = outbound ? getEntity('workshops', data.workshopId) : null
      if (data.supplierId) getEntity('suppliers', data.supplierId)
      if (data.productionId) {
        const production = getEntity('productions', data.productionId)
        if (production.status !== 'production') throw new Error('只有生产中的任务可以领料')
        putInventory('production_materials', { production_id: data.productionId, material_id: data.materialId, quantity,
          workshop_id: data.workshopId, workshop_name: workshop?.name || '', created_at: stamp }, true)
      }
      const unitPrice = data.unitPrice ?? 0
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('单价无效')
      changeStock('materials', data.materialId, outbound ? -quantity : quantity, data.productionId ? 'production_use' : outbound ? 'outbound' : 'inbound', data)
      const id = putInventory(outbound ? 'material_outbound' : 'material_inbound', { material_id: material.id, quantity,
        supplier_id: data.supplierId || null, workshop_id: data.workshopId || null, workshop_name: workshop?.name || '',
        production_id: data.productionId || 0, unit_price: unitPrice, total_price: Math.round(quantity * unitPrice * 100) / 100,
        purpose: data.purpose || '', operator: data.operator || '操作员', remark: data.remark || '', created_at: stamp }, true)
      result = { success: true, id }
    } else if (kind === 'production.start' || kind === 'production.complete') {
      const production = getEntity('productions', data.productionId)
      const start = kind === 'production.start'
      if (production.status !== (start ? 'pending' : 'production')) throw new Error('生产状态已变化，请刷新后重试')
      putInventory('productions', { ...production, status: start ? 'production' : 'completed',
        [start ? 'start_time' : 'finish_time']: stamp, updated_at: stamp })
    } else if (kind === 'production.warehouse') {
      const quantity = positive(data.quantity)
      const production = getEntity('productions', data.productionId)
      if (production.status !== 'completed') throw new Error('仅已完成且尚未入库的生产任务可以入库')
      const product = data.productCode ? queryOne('SELECT * FROM products WHERE productCode=?', [data.productCode]) : null
      if (data.productCode && !product) throw new Error('商品不存在')
      const productName = product?.productName || data.productName
      if (!productName?.trim()) throw new Error('成品名称不能为空')
      const id = putInventory('finished_products', { product_name: productName, product_code: product?.productCode || '',
        specification: product?.specification || '', unit: product?.unit || data.unit || '件', quantity: 0,
        production_id: production.id, order_id: production.order_id || 0, order_no: production.order_no || '', created_at: stamp, updated_at: stamp }, true)
      changeStock('finished_products', id, quantity, 'inbound', data)
      putInventory('finished_product_logs', { product_id: id, type: 'inbound', quantity, order_id: production.order_id || 0,
        operator: data.operator || '操作员', remark: data.remark || '生产入库', created_at: stamp }, true)
      putInventory('productions', { ...production, status: 'warehoused', updated_at: stamp })
      result = { success: true, id }
    } else if (kind === 'product.outbound') {
      const quantity = positive(data.quantity)
      const product = getEntity('finished_products', data.productId)
      const workshop = getEntity('workshops', data.workshopId)
      const linkedOrder = product.order_id && queryOne('SELECT status FROM orders WHERE id=?', [product.order_id])
      if (linkedOrder && ['draft','confirmed'].includes(linkedOrder.status)) throw new Error('该库存关联待发货订单，请到订单列表整单发货')
      if (data.productionId) {
        const production = getEntity('productions', data.productionId)
        if (production.status !== 'warehoused' || product.production_id !== production.id) throw new Error('生产任务与库存关联无效')
        const order = production.order_id && queryOne('SELECT status FROM orders WHERE id=?', [production.order_id])
        if (order && order.status !== 'legacy') throw new Error('此生产任务关联新订单，请到订单列表整单发货，避免重复扣库存')
      }
      changeStock('finished_products', product.id, -quantity, 'outbound', data)
      putInventory('finished_product_logs', { product_id: product.id, type: 'outbound', quantity, order_id: product.order_id || 0,
        workshop_id: workshop.id, workshop_name: workshop.name, operator: data.operator || '操作员', remark: data.remark || '手动出库', created_at: stamp }, true)
    } else throw new Error('不支持的库存操作')
    run('INSERT INTO inventory_requests (id,signature,result) VALUES (?,?,?)', [requestId, signature, JSON.stringify(result)])
    return result
  })
}
