import type { Order } from '../types'
import type { OrderStatus } from '../../electron/order-status'
import OrderDialog from './OrderDialog'
import OrderStatusPanel from './OrderStatusPanel'

export default function OrderMoreDialog({ order, onClose, onCopy, onAction, onDelete }: {
  order: Order; onClose: () => void; onCopy: () => void;
  onAction: (action: OrderStatus | 'history') => void; onDelete: () => void
}) {
  return <OrderDialog title={`订单操作 · ${order.documentNo || order.orderNo}`} onClose={onClose} className="order-more-dialog">
    <OrderStatusPanel status={order.status} />
    <div className="order-operation-grid">
      <button className="btn" onClick={onCopy}>复制为新草稿</button>
      <button className="btn" onClick={() => onAction('history')}>状态记录</button>
      {order.status === 'draft' && <button className="btn btn-primary" onClick={() => onAction('confirmed')}>确认订单</button>}
      {order.status === 'confirmed' && <><button className="btn btn-primary" onClick={() => onAction('shipped')}>整单发货</button><button className="btn" onClick={() => onAction('draft')}>退回草稿</button></>}
      {['draft','confirmed','shipped'].includes(order.status) && <button className="btn btn-danger" onClick={() => onAction('voided')}>{order.status === 'shipped' ? '退货并作废' : '作废订单'}</button>}
      {order.status === 'draft' && <button className="btn btn-danger" onClick={onDelete}>删除草稿</button>}
    </div>
    <div className="modal-footer"><button className="btn" onClick={onClose}>关闭</button></div>
  </OrderDialog>
}
