import type { OrderStatus } from '../../electron/order-status'
import { orderStatusLabels } from '../../electron/order-status'

const explanations: Record<OrderStatus, string> = {
  draft: '尚未确认，可以修改。保存只保留草稿；核对后点击“确认订单”，此时不扣库存。',
  confirmed: '已确认并锁定明细，尚未扣库存。实际发出时点击“整单发货”选择成品批次；需要修改可先“退回草稿”。',
  shipped: '已完成整单发货，库存已扣减。仅在整单实物退回后，才能通过“退货并作废”恢复原批次库存。',
  voided: '单据已作废，不能再次发货或修改。可以查看状态记录；如需重新开单，请复制为新草稿。',
  legacy: '升级前的历史单据，发货状态未记录，不能判断为草稿或已发货。保留原内容供查看、打印；不追溯扣库存。',
}
export default function OrderStatusPanel({ status }: { status: OrderStatus }) {
  return <section className="order-status-panel" aria-label="当前订单状态">
    <div className="order-status-heading"><span className="status-caption">当前状态</span><span className={`order-status status-${status}`}>{orderStatusLabels[status]}</span></div>
    <p className="status-explanation">{explanations[status]}</p>
    {status === 'legacy' ? <details className="order-status-help"><summary>历史单据说明</summary><p className="order-status-note">如需重新开单，可复制为新草稿并生成新单号。已经发出的历史订单请勿再次执行发货扣库。</p></details>
      : <ol className="order-status-steps" aria-label="订单流程">{(['draft','confirmed','shipped'] as const).map((step,index) => <li key={step} aria-current={status === step ? 'step' : undefined}><span>{index + 1}</span>{orderStatusLabels[step]}{index === 0 ? '（可编辑）' : index === 1 ? '（不扣库）' : '（已扣库）'}</li>)}</ol>}
  </section>
}
