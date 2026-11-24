import { orderStatusLabels } from '../../electron/order-status'
import type { OrderStatus } from '../../electron/order-status'
import OrderActionDialog from '../components/OrderActionDialog'
import OrderMoreDialog from '../components/OrderMoreDialog'
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchOrders, removeOrder } from '../utils/ipc'
import ConfirmDialog from '../components/ConfirmDialog'
import BackupControls from '../components/BackupControls'
import type { Order } from '../types'

const OrderList: React.FC = () => {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<(Order & { itemCount?: number; totalQuantity?: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [action, setAction] = useState<{ order: Order; target: OrderStatus | 'history' } | null>(null)
  const [moreOrder, setMoreOrder] = useState<Order | null>(null)
  const [archive, setArchive] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null)

  const loadOrders = useCallback(async (keyword?: string) => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchOrders(keyword || undefined)
      setOrders(data)
    } catch (err: any) {
      setError(err.message || '加载订单失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOrders()
    window.electronAPI.getInventoryArchiveSummary().then(rows => setArchive(rows.reduce((total,row) => total + row.count, 0))).catch(() => {})
  }, [loadOrders])

  const handleSearch = () => {
    loadOrders(search)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await removeOrder(deleteTarget.id)
      setDeleteTarget(null)
      loadOrders(search || undefined)
    } catch (err: any) {
      setError(err.message || '删除失败')
    }
  }

  const formatDate = (d: string) => {
    if (!d) return '-'
    return d.slice(0, 10)
  }

  const visibleOrders = orders.filter(order => !statusFilter || order.status === statusFilter)

  return (
    <div className="page-container">
      <div className="page-header">
        <div><span className="page-eyebrow">订单中心</span><h1>发货订单</h1></div>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => navigate('/orders/new')}>
            + 新建订单
          </button>
        </div>
      </div>

      <BackupControls />
      {archive > 0 && <p className="error-message">保留了 {archive} 条旧版备用库存记录，尚未自动合并，请核对后通过生产库存的期初/入库操作录入。在用库存与订单发货均以生产库存为准。</p>}
      <p className="order-list-guide">新订单：草稿 → 确认订单（不扣库存）→ 整单发货（扣库存）。历史单据的发货状态未记录，仅供查看和打印。</p>
      {error && <div className="error-message">{error}</div>}

      <div className="order-list-tools"><div className="order-status-tabs" aria-label="订单状态筛选">{[['','全部'],...Object.entries(orderStatusLabels)].map(([key,label]) => <button key={key} className="order-status-tab" aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>{label}<span>{key ? orders.filter(order => order.status === key).length : orders.length}</span></button>)}</div><div className="search-bar">
        <input
          type="text"
          placeholder="搜索订单号、客户名称..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary" onClick={handleSearch}>
          搜索
        </button>
        <button
          className="btn"
          onClick={() => {
            setSearch('')
            setStatusFilter('')
            loadOrders()
          }}
        >
          重置
        </button>
      </div></div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : visibleOrders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{search || statusFilter ? '当前条件下没有订单，可切换状态或重置搜索' : '暂无订单，请点击"新建订单"创建'}</p>
          </div>
        </div>
      ) : (
        <div className="order-list-table"><table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>序号</th>
              <th>单据编号</th>
              <th>订单号</th>
              <th>日期</th><th>状态</th>
              <th>收货单位</th>
              <th style={{ width: 80, textAlign: 'center' }}>商品数</th>
              <th style={{ width: 90, textAlign: 'center' }}>总数量</th>
              <th>发货单位</th>
              <th style={{ width: 280 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order, index) => (
              <tr key={order.id}>
                <td>{index + 1}</td>
                <td>{order.documentNo || '-'}</td>
                <td>{order.orderNo || '-'}</td>
                <td>{formatDate(order.date)}</td><td><span className={`order-status status-${order.status}`}>{orderStatusLabels[order.status] || order.status}</span></td>
                <td>{order.receiver || '-'}</td>
                <td style={{ textAlign: 'center' }}>{order.itemCount ?? 0}</td>
                <td style={{ textAlign: 'center' }}>{order.totalQuantity ?? 0}</td>
                <td>{order.sender || '-'}</td>
                <td className="actions-cell">
                  <div className="btn-group order-row-actions">
                    {order.status === 'draft' && <button className="btn btn-sm btn-primary" data-order-primary-action onClick={() => setAction({ order, target: 'confirmed' })}>确认订单</button>}
                    {order.status === 'confirmed' && <button className="btn btn-sm btn-primary" data-order-primary-action onClick={() => setAction({ order, target: 'shipped' })}>整单发货</button>}
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(order.status === 'draft' ? `/orders/${order.id}` : `/orders/${order.id}/view`)}
                    >
                      {order.status === 'draft' ? '编辑' : '查看'}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(`/orders/${order.id}/print`)}
                    >
                      打印
                    </button>
                    <button className="btn btn-sm order-more-trigger" aria-haspopup="dialog" aria-label={`更多操作 ${order.documentNo || order.orderNo}`} onClick={() => setMoreOrder(order)}>更多</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {!loading && <div className="order-list-footer"><span>当前显示 {visibleOrders.length} 张单据</span><span>确认不扣库 · 发货扣库 · 状态变更均有记录</span></div>}

      {moreOrder && <OrderMoreDialog order={moreOrder} onClose={() => setMoreOrder(null)}
        onCopy={() => { setMoreOrder(null); navigate('/orders/new', { state: { copyFrom: moreOrder.id } }) }}
        onAction={target => { setMoreOrder(null); setAction({ order: moreOrder, target }) }}
        onDelete={() => { setMoreOrder(null); setDeleteTarget(moreOrder) }} />}
      {action && <OrderActionDialog order={action.order} action={action.target} onClose={() => setAction(null)} onDone={() => { setAction(null); void loadOrders(search) }} />}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除"
          message={`确定要删除单据「${deleteTarget.documentNo || deleteTarget.orderNo || '未命名'}」吗？此操作不可恢复。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirmText="删除"
          danger
        />
      )}
    </div>
  )
}

export default OrderList
