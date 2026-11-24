import { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Order, OrderItem } from '../types'
import type { OrderStatus } from '../../electron/order-status'
import { fetchOrderById } from '../utils/ipc'
import { getPrintErrorMessage } from '../../electron/print-profile'
import OrderActionDialog from '../components/OrderActionDialog'
import OrderStatusPanel from '../components/OrderStatusPanel'

type Detail = Order & { items: OrderItem[] }
const fields: [keyof Order, string][] = [
  ['documentNo','单据编号'],['orderNo','订单号'],['date','日期'],['receiver','收货单位'],
  ['receiverContact','收货联系人'],['receiverPhone','收货电话'],['receiverAddress','收货地址'],
  ['sender','发货单位'],['senderPhone','发货电话'],['warehouse','发货仓库'],['maker','制单人'],
  ['carrierName','承运人'],['carrierVehicle','车牌号'],['outTime','出库时间'],['tonnage','吨位'],['mileage','里程'],['reviewer','审核人'],
]
export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const [action, setAction] = useState<OrderStatus | 'history' | null>(null)
  const load = useCallback(async () => {
    const current = ++request.current
    setError(''); setLoading(true)
    try { const data = await fetchOrderById(Number(id)); if (!data) throw new Error('订单不存在'); if (current === request.current) setOrder(data) }
    catch (error) { if (current === request.current) { setError(getPrintErrorMessage(error)); setOrder(null) } }
    finally { if (current === request.current) setLoading(false) }
  }, [id])
  useEffect(() => { void load(); return () => { request.current++ } }, [load])
  if (loading) return <div className="page-container"><div className="loading">加载单据…</div></div>
  if (!order) return <div className="page-container"><p role="alert" className="error-message">{error}</p><button className="btn" onClick={() => navigate('/')}>返回列表</button><button className="btn" onClick={() => void load()}>重试</button></div>
  const total = order.items.reduce((sum,item) => sum + item.amount, 0)
  return <div className="page-container" data-testid="order-detail">
    <div className="page-header"><div><h1>订单详情</h1><p className="order-document-number">{order.documentNo || order.orderNo}</p></div>
      <div className="btn-group"><button className="btn" onClick={() => navigate('/')}>返回列表</button><button className="btn" onClick={() => navigate(`/orders/${order.id}/print`)}>打印</button><button className="btn" onClick={() => navigate('/orders/new', { state: { copyFrom: order.id } })}>复制为新草稿</button></div>
    </div>
    <OrderStatusPanel status={order.status} />
    <div className="order-state-actions">
      {order.status === 'draft' && <><button className="btn btn-primary" data-order-primary-action onClick={() => setAction('confirmed')}>确认订单</button><button className="btn" onClick={() => navigate(`/orders/${order.id}`)}>编辑草稿</button></>}
      {order.status === 'confirmed' && <><button className="btn btn-primary" data-order-primary-action onClick={() => setAction('shipped')}>整单发货</button><button className="btn" onClick={() => setAction('draft')}>退回草稿</button></>}
      {['draft','confirmed','shipped'].includes(order.status) && <button className="btn btn-danger" onClick={() => setAction('voided')}>{order.status === 'shipped' ? '退货并作废' : '作废订单'}</button>}
      <button className="btn" onClick={() => setAction('history')}>状态记录</button>
    </div>
    <section className="card order-detail-section"><h2>开单与收发货信息</h2><dl className="order-detail-fields">{fields.map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{String(order[key] || '—')}</dd></div>)}</dl></section>
    <section className="card order-detail-section"><h2>商品明细 · {order.items.length} 项</h2><div className="order-detail-table-scroll"><table className="data-table order-detail-items"><thead><tr><th>商品编码</th><th>商品名称</th><th>规格</th><th>箱规</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>备注</th></tr></thead><tbody>{order.items.map(item => <tr key={item.id}><td>{item.productCode || '—'}</td><td>{item.productName}</td><td>{item.specification || '—'}</td><td>{item.packageSpec || '—'}</td><td>{item.unit}</td><td>{item.quantity}</td><td>{item.price.toFixed(2)}</td><td>{item.amount.toFixed(2)}</td><td>{item.remark || '—'}</td></tr>)}</tbody></table></div>{!order.items.length && <p>暂无商品明细</p>}<p className="order-detail-total">金额合计：¥{total.toFixed(2)}</p></section>
    <section className="card order-detail-section"><h2>单据备注</h2><p className="order-detail-remark">{order.remark || '暂无备注'}</p></section>
    {action && <OrderActionDialog order={order} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load() }} />}
  </div>
}
