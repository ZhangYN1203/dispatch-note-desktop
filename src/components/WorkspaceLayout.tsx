import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { OrderSystemActivity } from './SystemActivity'
import OrderDialog from './OrderDialog'
import SystemChoices from './SystemChoices'
import type { WorkSystem } from './SystemChoices'
import { getPrintErrorMessage } from '../../electron/print-profile'

interface ProductionModule {
  setVisible: (visible: boolean, host?: HTMLElement) => Promise<void>
  canSwitchSystem: () => boolean
}
function Mark({ type }: { type: 'orders' | 'summary' | 'products' | 'customers' | 'stock' }) {
  const paths = {
    orders: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
    summary: 'M4 20h16 M7 16V9 M12 16V4 M17 16v-5',
    products: 'M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10',
    customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19 8v6 M16 11h6',
    stock: 'M3 21V8l6 3V6l6 3V3h6v18z M7 16h1 M12 16h1 M17 16h1',
  }
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[type]} /></svg>
}
export default function WorkspaceLayout() {
  const { pathname } = useLocation()
  const [system, setSystem] = useState<WorkSystem | null>(null)
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const productionHost = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [pathname, system])
  const choose = useCallback(async (next: WorkSystem) => {
    if (busyRef.current) return
    if (next === system) { setSwitching(false); setError(''); return }
    setError('')
    const module = (window as Window & { __newModule?: ProductionModule }).__newModule
    if (system === 'orders' && !window.dispatchEvent(new Event('workspace:before-system-switch', { cancelable: true }))) return
    if (system === 'production' && module && !module.canSwitchSystem()) { setError('请先完成或关闭当前库存操作，再切换系统。'); return }
    busyRef.current = true; setBusy(true)
    try {
      if (next === 'production') {
        await window.inventoryReady
        if (!module || !productionHost.current) throw new Error('生产库存模块尚未就绪，请稍后重试')
        await module.setVisible(true, productionHost.current)
      } else if (module) await module.setVisible(false)
      setSystem(next); setSwitching(false)
    } catch (error) { setError(getPrintErrorMessage(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }, [system])
  const openChooser = useCallback(() => { if (!busyRef.current) { setError(''); setSwitching(true) } }, [])
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent<WorkSystem>).detail
      if (target === 'orders' || target === 'production') void choose(target)
    }
    window.addEventListener('workspace:choose-system', openChooser)
    window.addEventListener('workspace:open-system', open)
    return () => { window.removeEventListener('workspace:choose-system', openChooser); window.removeEventListener('workspace:open-system', open) }
  }, [choose, openChooser])
  useEffect(() => { document.title = system === 'orders' ? '订单与发货 · 本地业务工作台' : system === 'production' ? '生产与库存 · 本地业务工作台' : '选择系统 · 本地业务工作台' }, [system])
  const title = system === 'orders' ? '订单与发货' : system === 'production' ? '生产与库存' : '业务工作台'
  return <div className="workspace" data-system={system || 'choose'} aria-busy={busy}>
    <header className="workspace-header no-print">
      <button className="workspace-brand workspace-brand-button" aria-label="选择工作系统" onClick={openChooser} disabled={!system || busy}><span className="workspace-logo"><Mark type={system === 'production' ? 'stock' : 'orders'} /></span><span>{title}<small>{system === 'orders' ? '客户 · 开单 · 打印' : system === 'production' ? '原料 · 生产 · 成品' : '订单与生产 / 本地业务'}</small></span></button>
      {system === 'orders' && <nav aria-label="订单与发货导航">
        <NavLink to="/" end className={pathname === '/' || pathname.startsWith('/orders/') ? 'workspace-nav active' : 'workspace-nav'}><Mark type="orders" />订单</NavLink>
        <NavLink to="/order-summary" className={({isActive}) => `workspace-nav${isActive ? ' active' : ''}`}><Mark type="summary" />订单汇总</NavLink>
        <NavLink to="/product-manager" className={({isActive}) => `workspace-nav${isActive ? ' active' : ''}`}><Mark type="products" />商品与定价</NavLink>
        <NavLink to="/customer-manager" className={({isActive}) => `workspace-nav${isActive ? ' active' : ''}`}><Mark type="customers" />客户</NavLink>
      </nav>}
      {system === 'production' && <span className="system-header-description">生产管理与库存台账</span>}
      <div className="workspace-header-end"><span className="workspace-local"><i />本地数据</span>{system && <button className="system-switch-button" data-testid="system-switch" aria-haspopup="dialog" onClick={openChooser} disabled={busy}><span aria-hidden="true">⇄</span>切换系统</button>}</div>
    </header>
    {!system && <section className="system-welcome">
      <div className="system-welcome-intro"><span className="page-eyebrow">本地业务工作台</span><h1>选择工作系统</h1><p>选择要进入的系统。进入后，可通过顶部“切换系统”随时切换。</p></div>
      <SystemChoices current={null} busy={busy} onChoose={next => void choose(next)} />
      <p className="system-shared-note">两个系统共用本地业务数据，订单发货与库存流水保持关联。</p>
      {error && <p className="error-message" role="alert">{error}</p>}{busy && <p role="status" className="system-loading">正在进入系统…</p>}
    </section>}
    <OrderSystemActivity.Provider value={system === 'orders'}><main className="workspace-content" hidden={system !== 'orders'}><Outlet /></main></OrderSystemActivity.Provider>
    <div ref={productionHost} id="production-system-host" hidden={system !== 'production'} />
    {system && switching && <OrderDialog title="切换工作系统" onClose={() => setSwitching(false)} busy={busy} className="system-switch-dialog">
      <p className="system-switch-intro">当前：{title}。选择另一个系统，或返回继续工作。</p>
      <SystemChoices current={system} busy={busy} onChoose={next => void choose(next)} />
      {error && <p className="error-message" role="alert">{error}</p>}{busy && <p role="status" className="system-loading">正在进入系统…</p>}
      <div className="modal-footer"><button className="btn" disabled={busy} onClick={() => setSwitching(false)}>取消切换</button></div>
    </OrderDialog>}
  </div>
}
