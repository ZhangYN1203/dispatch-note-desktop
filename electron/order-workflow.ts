import { queryAll, queryOne, run, withTransaction } from './database'
import { getEntity, changeStock } from './inventory-service'
import { putInventory } from './inventory'

import type { OrderStatus } from './order-status'
export function assertDraftOrder(id: number): void {
  const order = queryOne('SELECT status FROM orders WHERE id=?', [id])
  if (!order) throw new Error('订单不存在')
  if (order.status !== 'draft') throw new Error('仅草稿订单可以编辑或删除，请先退回草稿；历史单据可复制为新单')
}
export function getOrderEvents(id: number) {
  return queryAll('SELECT * FROM order_events WHERE orderId=? ORDER BY id', [id])
}
export function transitionOrder(id: number, target: OrderStatus, options: { reason?: string; returnStock?: boolean; allocations?: { itemId: number; stockId: number }[] } = {}) {
  return withTransaction(() => {
    const order = queryOne('SELECT * FROM orders WHERE id=?', [id])
    if (!order) throw new Error('订单不存在')
    const from = order.status
    const items = queryAll('SELECT * FROM order_items WHERE orderId=? ORDER BY sortOrder', [id])
    if (['confirmed','shipped'].includes(target) && items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0 || !Number.isFinite(item.amount))) throw new Error('订单明细数量或金额无效，请退回草稿核对')
    if (from === 'legacy' || from === 'voided') throw new Error('历史或已作废单据不能变更状态，可复制为新单')
    if (target === 'confirmed') {
      if (from !== 'draft' || !items.length || !order.receiver.trim()) throw new Error('确认需要草稿订单、收货单位和商品明细')
    } else if (target === 'draft') {
      if (from !== 'confirmed') throw new Error('仅已确认订单可退回草稿')
    } else if (target === 'shipped') {
      if (from !== 'confirmed') throw new Error('仅已确认且未发货订单可以发货')
      const allocations = options.allocations || []
      if (allocations.length !== items.length || new Set(allocations.map(line => line.itemId)).size !== items.length) throw new Error('必须为每行商品明确选择成品库存')
      for (const item of items) {
        const allocation = allocations.find(line => line.itemId === item.id)
        if (!allocation) throw new Error('发货明细不匹配')
        const stock = getEntity('finished_products', allocation.stockId)
        if (stock.product_code && stock.product_code !== item.productCode) throw new Error('选择的成品与订单商品编码不一致')
        if (item.unit && stock.unit && stock.unit !== item.unit) throw new Error('商品与库存单位不一致，请先核对')
        changeStock('finished_products', stock.id, -item.quantity, 'order_shipment', { orderId: id, remark: `订单 ${order.documentNo} 发货` })
        putInventory('finished_product_logs', { product_id: stock.id, type: 'outbound', quantity: item.quantity, order_id: id,
          operator: order.maker || '操作员', remark: `订单 ${order.documentNo} 发货`, created_at: new Date().toISOString() }, true)
        run('INSERT INTO order_shipments (orderId,itemId,stockId,quantity) VALUES (?,?,?,?)', [id, item.id, stock.id, item.quantity])
      }
    } else if (target === 'voided') {
      if (!['draft', 'confirmed', 'shipped'].includes(from) || !options.reason?.trim()) throw new Error('作废需要填写原因')
      if (from === 'shipped') {
        if (options.returnStock !== true) throw new Error('已发货单据作废必须确认货物已退回')
        for (const shipment of queryAll('SELECT * FROM order_shipments WHERE orderId=? AND returned=0', [id])) {
          changeStock('finished_products', shipment.stockId, shipment.quantity, 'order_return', { orderId: id, remark: options.reason })
          putInventory('finished_product_logs', { product_id: shipment.stockId, type: 'inbound', quantity: shipment.quantity, order_id: id,
            operator: order.maker || '操作员', remark: `作废退回：${options.reason}`, created_at: new Date().toISOString() }, true)
          run('UPDATE order_shipments SET returned=1 WHERE orderId=? AND itemId=?', [id, shipment.itemId])
        }
      }
    } else throw new Error('不支持的订单状态')
    run("UPDATE orders SET status=?,updatedAt=datetime('now','localtime') WHERE id=?", [target, id])
    run('INSERT INTO order_events (orderId,fromStatus,toStatus,reason,createdAt) VALUES (?,?,?,?,?)', [id, from, target, options.reason || '', new Date().toISOString()])
    return { success: true, status: target }
  })
}
