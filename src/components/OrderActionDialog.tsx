import { useEffect, useRef, useState } from 'react'
import type { Order, OrderItem } from '../types'
import { orderStatusLabels } from '../../electron/order-status'
import type { OrderStatus } from '../../electron/order-status'
import { getPrintErrorMessage } from '../../electron/print-profile'

export default function OrderActionDialog({ order, action, onClose, onDone }: {
  order: Order; action: OrderStatus | 'history'; onClose: () => void; onDone: () => void
}) {
  const [items, setItems] = useState<OrderItem[]>([])
  const [stocks, setStocks] = useState<Record<string, any>[]>([])
  const [events, setEvents] = useState<{ fromStatus: string; toStatus: string; reason: string; createdAt: string }[]>([])
  const [allocations, setAllocations] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('')
  const [returned, setReturned] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([window.electronAPI.getOrderById(order.id), window.electronAPI.listInventory('finished_products'), window.electronAPI.getOrderEvents(order.id)])
      .then(([data, stock, history]) => { if (active) { setItems(data?.items || []); setStocks(stock); setEvents(history); setReady(true) } })
      .catch(error => { if (active) setError(getPrintErrorMessage(error)) })
    return () => { active = false }
  }, [order.id])
  const submit = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      await window.electronAPI.transitionOrder(order.id, action as OrderStatus, {
        reason, returnStock: returned, allocations: items.map(item => ({ itemId: item.id, stockId: allocations[item.id] })),
      })
      onDone()
    } catch (error) { setError(getPrintErrorMessage(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const disabled = busy || !ready || (action === 'shipped' && (!items.length || items.some(item => !allocations[item.id])))
    || (action === 'voided' && (!reason.trim() || (order.status === 'shipped' && !returned)))
  return <div className="modal-overlay no-print"><div className="modal-dialog order-action-dialog" role="dialog" aria-modal="true" aria-labelledby="order-action-title">
    <h2 id="order-action-title">{action === 'history' ? '状态记录' : `订单：${orderStatusLabels[action]}`} · {order.documentNo}</h2>
    {action === 'confirmed' && <p>确认后锁定明细，此时不扣库存。发货前仍可退回草稿修改。</p>}
    {action === 'draft' && <p>退回草稿后可以修改订单，库存不变。</p>}
    {action === 'shipped' && <><p>为每行商品选择实际发出的成品库存。整单发货会扣减库存并记录流水，任一行失败整单回滚。</p>
      {items.map(item => <label className="form-field" key={item.id}>{item.productName} · {item.quantity} {item.unit}
        <select aria-label={`发货库存-${item.id}`} value={allocations[item.id] || ''} onChange={event => setAllocations(previous => ({ ...previous, [item.id]: Number(event.target.value) }))}>
          <option value="">请选择成品库存</option>{stocks.filter(stock => stock.quantity > 0 && (!stock.product_code || stock.product_code === item.productCode) && (!stock.unit || !item.unit || stock.unit === item.unit)).map(stock => <option key={stock.id} value={stock.id}>{stock.product_name} · 库存 {stock.quantity} {stock.unit} · 批次 #{stock.id}</option>)}
        </select>
      </label>)}</>}
    {action === 'voided' && <><label className="form-field">作废原因<input aria-label="作废原因" value={reason} onChange={event => setReason(event.target.value)} maxLength={300} /></label>
      {order.status === 'shipped' && <label><input type="checkbox" checked={returned} onChange={event => setReturned(event.target.checked)} />确认整单货物已经退回，恢复原发货库存；未退回请勿作废。</label>}
    </>}
    {action === 'history' && <div>{events.length ? events.map((event, index) => <p key={index}>{new Date(event.createdAt).toLocaleString()} · {orderStatusLabels[event.fromStatus as OrderStatus]} → {orderStatusLabels[event.toStatus as OrderStatus]} {event.reason}</p>) : <p>尚无状态变更记录。历史单据不会推断以前的发货或库存。</p>}</div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="modal-footer"><button className="btn" disabled={busy} onClick={onClose}>取消</button>{action !== 'history' && <button className="btn btn-primary" disabled={disabled} onClick={() => void submit()}>{busy ? '处理中…' : '确认操作'}</button>}</div>
  </div></div>
}
