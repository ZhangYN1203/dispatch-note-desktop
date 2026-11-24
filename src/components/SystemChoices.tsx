export type WorkSystem = 'orders' | 'production'

export default function SystemChoices({ current, busy, onChoose }: {
  current: WorkSystem | null; busy: boolean; onChoose: (system: WorkSystem) => void
}) {
  return <div className="system-choices" data-testid="system-chooser">
    <button className={`system-card system-card-orders${current === 'orders' ? ' current' : ''}`} data-system-choice="orders" disabled={busy} onClick={() => onChoose('orders')}>
      <span className="system-card-top"><span className="system-card-icon"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4h16v24H8z M12 10h8 M12 15h8 M12 20h5" /></svg></span><span className="system-card-number">01 / 订单业务</span></span>
      <strong>订单与发货</strong><span className="system-card-description">从客户开单到发货打印，处理日常订单业务。</span>
      <span className="system-card-features"><span>订单管理</span><span>客户定价</span><span>发货打印</span></span>
      <span className="system-card-enter">{current === 'orders' ? '返回当前系统' : '进入订单与发货'}<span aria-hidden="true">↗</span></span>
    </button>
    <button className={`system-card system-card-production${current === 'production' ? ' current' : ''}`} data-system-choice="production" disabled={busy} onClick={() => onChoose('production')}>
      <span className="system-card-top"><span className="system-card-icon"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 28V12l8 4V9l8 4V4h8v24z M9 21h2 M16 21h2 M23 21h2" /></svg></span><span className="system-card-number">02 / 生产业务</span></span>
      <strong>生产与库存</strong><span className="system-card-description">从原料领用到成品入库，管理生产与库存流转。</span>
      <span className="system-card-features"><span>原料收发</span><span>生产任务</span><span>库存台账</span></span>
      <span className="system-card-enter">{current === 'production' ? '返回当前系统' : '进入生产与库存'}<span aria-hidden="true">↗</span></span>
    </button>
  </div>
}
