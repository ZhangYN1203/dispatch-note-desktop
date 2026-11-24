export type OrderStatus = 'draft' | 'confirmed' | 'shipped' | 'voided' | 'legacy'
export const orderStatusLabels: Record<OrderStatus, string> = {
  draft: '草稿', confirmed: '已确认', shipped: '已发货', voided: '已作废', legacy: '历史单据',
}
