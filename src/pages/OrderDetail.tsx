import { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Order, OrderItem } from '../types'
import type { OrderStatus } from '../../electron/order-status'
import { fetchOrderById } from '../utils/ipc'
import { getPrintErrorMessage } from '../../electron/print-profile'
import OrderActionDialog from '../components/OrderActionDialog'
import OrderStatusPanel from '../components/OrderStatusPanel'

type Detail = Order & { items: OrderItem[] }
const supplement: [keyof Order, string][] = [
  ['carrierName','承运人'],['carrierVehicle','车牌号'],['outTime','出库时间'],['tonnage','吨位'],['mileage','里程'],['reviewer','审核人'],
]
function Party({ title, name, fields }: { title: string; name: string; fields: [string, string][] }) {
  const filled = fields.filter(([,value]) => value?.trim())
  return <section className="detail-party"><span className="party-label">{title}</span><h3>{name || '未填写单位'}</h3><dl>{filled.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
}
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
    <div className="page-header"><div><span className="page-eyebrow">发货单据</span><h1>订单详情</h1><p className="order-document-number">{order.documentNo || order.orderNo}</p></div>
      <div className="btn-group"><button className="btn" onClick={() => navigate('/')}>返回列表</button><button className="btn" onClick={() => navigate(`/orders/${order.id}/print`)}>打印</button><button className="btn" onClick={() => navigate('/orders/new', { state: { copyFrom: order.id } })}>复制为新草稿</button></div>
    </div>
    <div className="detail-status-bar"><OrderStatusPanel status={order.status} />
    <div className="order-state-actions">
      {order.status === 'draft' && <><button className="btn btn-primary" data-order-primary-action onClick={() => setAction('confirmed')}>确认订单</button><button className="btn" onClick={() => navigate(`/orders/${order.id}`)}>编辑草稿</button></>}
      {order.status === 'confirmed' && <><button className="btn btn-primary" data-order-primary-action onClick={() => setAction('shipped')}>整单发货</button><button className="btn" onClick={() => setAction('draft')}>退回草稿</button></>}
      {['draft','confirmed','shipped'].includes(order.status) && <button className="btn btn-danger" onClick={() => setAction('voided')}>{order.status === 'shipped' ? '退货并作废' : '作废订单'}</button>}
      <button className="btn" onClick={() => setAction('history')}>状态记录</button>
    </div></div>
    <section className="card order-detail-section document-information">
      <div className="document-meta"><span>日期 <strong>{order.date || '未填写'}</strong></span>{order.orderNo && <span>订单号 <strong>{order.orderNo}</strong></span>}{order.warehouse && <span>仓库 <strong>{order.warehouse}</strong></span>}{order.maker && <span>制单人 <strong>{order.maker}</strong></span>}</div>
      <div className="detail-parties">
        <Party title="收货方" name={order.receiver} fields={[["联系人",order.receiverContact],["电话",order.receiverPhone],["地址",order.receiverAddress]]} />
        <Party title="发货方" name={order.sender} fields={[["电话",order.senderPhone]]} />
      </div>
      <details className="detail-supplement"><summary>运输与审核等补充信息 <span>{supplement.filter(([key]) => order[key]).length ? `${supplement.filter(([key]) => order[key]).length} 项已填写` : '未填写'}</span></summary><dl className="supplement-fields">{supplement.map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{String(order[key] || '—')}</dd></div>)}</dl></details>
    </section>
    <section className="card order-detail-section"><div className="detail-items-heading"><h2>商品明细 <span>{order.items.length} 项</span></h2><span className="snapshot-label">单据快照</span></div><div className="order-detail-table-scroll"><table className="data-table order-detail-items"><thead><tr><th>商品编码</th><th>商品名称</th><th>规格</th><th>箱规</th><th>单位</th><th className="numeric">数量</th><th className="numeric">单价</th><th className="numeric">金额</th><th>备注</th></tr></thead><tbody>{order.items.map(item => <tr key={item.id}><td className="cell-code">{item.productCode || '—'}</td><td>{item.productName}</td><td>{item.specification || '—'}</td><td>{item.packageSpec || '—'}</td><td>{item.unit}</td><td className="numeric">{item.quantity}</td><td className="numeric">{item.price.toFixed(2)}</td><td className="numeric amount-cell">{item.amount.toFixed(2)}</td><td>{item.remark || '—'}</td></tr>)}</tbody></table></div>{!order.items.length && <p>暂无商品明细</p>}<div className="order-detail-total"><span>{order.items.length} 项商品</span><div><span>金额合计</span><strong>¥{total.toFixed(2)}</strong></div></div></section>
    {order.remark && <section className="detail-remark"><span>单据备注</span><p>{order.remark}</p></section>}
    {action && <OrderActionDialog order={order} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load() }} />}
  </div>
}
