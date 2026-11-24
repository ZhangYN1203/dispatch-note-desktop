import { orderStatusLabels } from '../../electron/order-status'
import type { OrderStatus } from '../../electron/order-status'
import OrderActionDialog from '../components/OrderActionDialog'
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>商品装具调拨单</h1>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => navigate('/orders/new')}>
            + 新建订单
          </button>
          <button className="btn" onClick={() => navigate('/order-summary')}>
            订单汇总
          </button>
          <button className="btn" onClick={() => navigate('/product-manager')}>
            商品管理
          </button>
          <button className="btn" onClick={() => navigate('/customer-manager')}>
            客户管理
          </button>
        </div>
      </div>

      <BackupControls />
      {archive > 0 && <p className="error-message">保留了 {archive} 条旧版备用库存记录，尚未自动合并，请核对后通过生产库存的期初/入库操作录入。在用库存与订单发货均以生产库存为准。</p>}
      {error && <div className="error-message">{error}</div>}

      <div className="search-bar">
        <select aria-label="订单状态" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">全部状态</option>{Object.entries(orderStatusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
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
            loadOrders()
          }}
        >
          重置
        </button>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : orders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{search ? '未找到匹配的订单' : '暂无订单，请点击"新建订单"创建'}</p>
          </div>
        </div>
      ) : (
        <table className="data-table">
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
              <th style={{ width: 200 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.filter(order => !statusFilter || order.status === statusFilter).map((order, index) => (
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
                  <div className="btn-group">
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(`/orders/${order.id}`)}
                    >
                      {order.status === 'draft' ? '编辑' : '查看'}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(`/orders/${order.id}/print`)}
                    >
                      打印
                    </button>
                    <details className="order-more-actions"><summary>更多</summary><div>
                      <button className="btn btn-sm" onClick={() => navigate('/orders/new', { state: { copyFrom: order.id } })}>复制</button>
                      {order.status === 'draft' && <button className="btn btn-sm" onClick={() => setAction({ order, target: 'confirmed' })}>确认订单</button>}
                      {order.status === 'confirmed' && <><button className="btn btn-sm" onClick={() => setAction({ order, target: 'draft' })}>退回草稿</button><button className="btn btn-sm" onClick={() => setAction({ order, target: 'shipped' })}>整单发货</button></>}
                      {['draft','confirmed','shipped'].includes(order.status) && <button className="btn btn-sm" onClick={() => setAction({ order, target: 'voided' })}>作废</button>}
                      <button className="btn btn-sm" onClick={() => setAction({ order, target: 'history' })}>状态记录</button>
                      {order.status === 'draft' && <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(order)}>删除草稿</button>}
                    </div></details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
