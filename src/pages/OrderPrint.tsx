import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOrderById, printWindow } from '../utils/ipc'
import type { Order, OrderItem } from '../types'
import { DEFAULT_PRINT_PROFILE, getDriverGuidance, getPageGeometry, getPrintErrorMessage } from '../../electron/print-profile'
import type { PrintConfiguration, PrintProfile } from '../../electron/print-profile'
import PrintSettingsDialog from '../components/PrintSettingsDialog'
import '../styles/print.css'

const OrderPrint: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const printRef = useRef<HTMLDivElement>(null)
  const [order, setOrder] = useState<(Order & { items: OrderItem[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printError, setPrintError] = useState('')
  const [profile, setProfile] = useState<PrintProfile>({ ...DEFAULT_PRINT_PROFILE })
  const [config, setConfig] = useState<PrintConfiguration>({ active: profile, profiles: {} })
  const [settingsReady, setSettingsReady] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [dialogMode, setDialogMode] = useState<'settings' | 'print' | null>(null)
  const [pendingPrint, setPendingPrint] = useState(false)
  const printBusy = useRef(false)
  const [pagination, setPagination] = useState({ key: '', rows: 10 })
  const [layout, setLayout] = useState({ key: '', ready: false, error: '' })
  const geometry = getPageGeometry(profile)
  const layoutKey = JSON.stringify([profile, order?.id, order?.items])
  const rowsPerPage = pagination.key === layoutKey ? pagination.rows : profile.maxRowsPerPage
  const layoutReady = layout.key === layoutKey && layout.ready
  const layoutError = layout.key === layoutKey ? layout.error : ''

  useEffect(() => {
    let alive = true
    window.electronAPI.getPrintConfiguration().then(value => {
      if (!alive) return
      setProfile(value.active); setConfig(value); setSettingsReady(true)
      if (value.warning) setPrintError(value.warning)
    }).catch(error => { if (alive) setPrintError('加载打印设置失败：' + getPrintErrorMessage(error)) })
    return () => { alive = false }
  }, [])

  useLayoutEffect(() => {
    const values: Record<string, string> = {
      '--print-paper-width': `${geometry.widthMm}mm`, '--page-height': `${geometry.heightMm}mm`,
      '--print-margin-top': `${profile.marginTopMm}mm`, '--print-margin-bottom': `${profile.marginBottomMm}mm`,
      '--print-margin-left': `${profile.marginLeftMm}mm`, '--print-margin-right': `${profile.marginRightMm}mm`,
      '--print-font-size': `${profile.fontSizePt}pt`,
    }
    for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(key, value)
    const style = document.createElement('style')
    style.textContent = `@page { size: ${geometry.widthMm}mm ${geometry.heightMm}mm; margin: 0; }`
    document.head.appendChild(style)
    return () => {
      style.remove()
      for (const key of Object.keys(values)) document.documentElement.style.removeProperty(key)
    }
  }, [profile])

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoading(true); setOrder(null); setError('')
    fetchOrderById(Number(id)).then(data => {
      if (!alive) return
      if (!data) setError('订单不存在')
      else setOrder(data)
    }).catch(error => { if (alive) setError(error.message || '加载订单失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  useLayoutEffect(() => {
    if (!order || !printRef.current) return
    let active = true
    const measure = () => {
      if (!active) return
      const allowed = geometry.contentHeightMm * 96 / 25.4 - 2
      const contents = Array.from(printRef.current?.querySelectorAll<HTMLElement>('.print-page-content') || [])
      const tooWide = contents.some(content => content.scrollWidth > content.clientWidth + 1)
      const tallest = Math.max(0, ...contents.map(content => {
        const last = content.lastElementChild
        return last ? last.getBoundingClientRect().bottom - content.getBoundingClientRect().top : 0
      }))
      const tooTall = tallest > allowed
      if (tooTall && !tooWide && rowsPerPage > 1) {
        const heights = contents.flatMap(content => Array.from(content.querySelectorAll('tbody tr')).map(row => row.getBoundingClientRect().height)).filter(value => value > 0)
        const remove = Math.max(1, Math.ceil((tallest - allowed) / Math.max(1, Math.min(...heights))))
        setPagination({ key: layoutKey, rows: Math.max(1, rowsPerPage - remove) })
        setLayout({ key: layoutKey, ready: false, error: '' })
      } else {
        setLayout({ key: layoutKey, ready: true, error: tooWide ? '内容超出纸张宽度，请增加宽度、切换横向或减小字号。'
          : tooTall ? '单行内容超出可打印高度，请增大纸张高度、减小边距或字号。' : '' })
      }
    }
    if (document.fonts.status === 'loaded') measure()
    else void document.fonts.ready.then(measure)
    return () => { active = false }
  }, [layoutKey, rowsPerPage])

  const openPrintDialog = useCallback(() => {
    if (!printBusy.current && settingsReady && order) setDialogMode('print')
  }, [settingsReady, order])

  const applyProfile = async (next: PrintProfile, print: boolean) => {
    if (printBusy.current) return
    printBusy.current = true; setPrinting(true); setPrintError('')
    try {
      const saved = await window.electronAPI.savePrinterProfile(next)
      setProfile(saved)
      setConfig(previous => ({ active: saved, profiles: { ...previous.profiles, [saved.printerName || 'default']: saved } }))
      setDialogMode(null)
      if (print) setPendingPrint(true)
      else { printBusy.current = false; setPrinting(false) }
    } catch (error) { printBusy.current = false; setPrinting(false); throw error }
  }

  useEffect(() => {
    if (!pendingPrint || !layoutReady) return
    setPendingPrint(false)
    if (layoutError) { setPrintError(layoutError); printBusy.current = false; setPrinting(false); return }
    void printWindow(profile).catch(error => setPrintError(getPrintErrorMessage(error)))
      .finally(() => { printBusy.current = false; setPrinting(false) })
  }, [pendingPrint, layoutReady, layoutError, profile])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); openPrintDialog()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPrintDialog])

  if (loading) return <div className="page-container"><div className="loading">加载中...</div></div>
  if (error || !order) return <div className="page-container">
    <div className="error-message">{error || '订单不存在'}</div>
    <button className="btn" onClick={() => navigate('/')}>返回列表</button>
  </div>

  const totalQty = order.items.reduce((sum, it) => sum + (it.quantity || 0), 0)
  const totalAmount = order.items.reduce((sum, it) => sum + (it.amount || 0), 0)

  // Split items into pages
  const pages: OrderItem[][] = []
  for (let i = 0; i < order.items.length; i += rowsPerPage) {
    pages.push(order.items.slice(i, i + rowsPerPage))
  }
  if (pages.length === 0) pages.push([])

  const renderHeader = () => (
    <>
      <div className="print-header">
        <div className="company-name">{order.sender || ''}</div>
        <div className="print-title">商品装具调拨单</div>
        <div className="print-doc-no">No: {order.documentNo || ''}</div>
      </div>
      <table className="info-table">
        <tbody>
          <tr>
            <td className="info-label">日期</td>
            <td className="info-value">{order.date || ''}</td>
            <td className="info-label">收货单位</td>
            <td className="info-value">{order.receiver || ''}</td>
          </tr>
          <tr>
            <td className="info-label">发货单位</td>
            <td className="info-value">{order.sender || ''}</td>
            <td className="info-label">收货地址</td>
            <td className="info-value">{order.receiverAddress || ''}</td>
          </tr>
          <tr>
            <td className="info-label">电话</td>
            <td className="info-value">{order.senderPhone || ''}</td>
            <td className="info-label">收货联系人</td>
            <td className="info-value">{order.receiverContact || ''}</td>
          </tr>
        </tbody>
      </table>
    </>
  )

  const renderFooter = () => (
    <>
      <div className="sign-section">
        <div className="sign-row">
          <div className="sign-field">
            <span className="sign-label">制单人：</span>
            <span className="sign-value">{order.maker || ''}</span>
          </div>
          <div className="sign-field">
            <span className="sign-label">复核：</span>
            <span className="sign-value">{order.reviewer || ''}</span>
          </div>
          <div className="sign-field">
            <span className="sign-label">承运人签字：</span>
            <span className="sign-value"></span>
          </div>
          <div className="sign-field">
            <span className="sign-label">收货人签字：</span>
            <span className="sign-value"></span>
          </div>
        </div>
      </div>
      <div className="footer-section">
        <div className="footer-left">
          {order.remark && <div className="remark">备注：{order.remark}</div>}
        </div>
      </div>
    </>
  )

  const isLastPage = (pageIndex: number) => pageIndex === pages.length - 1

  return (
    <div className="print-page-wrapper">
      <div className="no-print toolbar">
        <button className="btn" disabled={printing} onClick={() => navigate('/')}>← 返回列表</button>
        <button className="btn" disabled={printing} onClick={() => navigate(`/orders/${id}`)}>编辑订单</button>
        <button className="btn print-settings-button" disabled={printing || !settingsReady} onClick={() => setDialogMode('settings')}>打印规格…</button>
        <button className="btn btn-primary" disabled={printing || !settingsReady} onClick={openPrintDialog}>
          {printing ? '正在准备 / 打印…' : '打印 (Ctrl+P)'}
        </button>
        <span className="print-profile-summary">{geometry.widthMm} × {geometry.heightMm} mm · {profile.fontSizePt} 磅 · {pages.length} 页</span>
      </div>
      {(printError || layoutError) && <div role="alert" className="error-message no-print">{printError || layoutError}</div>}
      <details className="print-driver-guide no-print">
        <summary>本地打印设置建议（与当前预览一致）</summary>
        <ol>{getDriverGuidance(profile).map(line => <li key={line}>{line}</li>)}</ol>
      </details>
      {dialogMode && <PrintSettingsDialog profile={profile} config={config} busy={printing}
        printRequested={dialogMode === 'print'} onApply={applyProfile} onClose={() => setDialogMode(null)} />}

      {/* Print area */}
      <div className="print-area" ref={printRef} aria-busy={!layoutReady}>
        {pages.map((pageItems, pageIndex) => (
          <div key={pageIndex} className="print-page"><div className="print-page-content">
            {renderHeader()}

            <table className="items-table">
              <thead>
                <tr>
                  <th className="col-seq">序号</th>
                  <th className="col-name">商品名称</th>
                  <th className="col-spec">规格</th>
                  <th className="col-pkg">整箱规格</th>
                  <th className="col-qty">数量</th>
                  <th className="col-price">单价</th>
                  <th className="col-amount">金额</th>
                  <th className="col-sign">签收意见</th>
                </tr>
              </thead>
              <tbody>
                {pages.length === 1 && pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#999' }}>
                      暂无商品明细
                    </td>
                  </tr>
                ) : (
                  pageItems.map((item, index) => (
                    <tr key={item.id}>
                      <td className="col-seq">{pageIndex * rowsPerPage + index + 1}</td>
                      <td className="col-name">
                        {item.productName || ''}
                        {item.unit ? `（${item.unit}）` : ''}
                        {item.productCode ? <span className="product-code">{` [${item.productCode}]`}</span> : ''}
                      </td>
                      <td className="col-spec">{item.specification || ''}</td>
                      <td className="col-pkg">{item.packageSpec || ''}</td>
                      <td className="col-qty">{item.quantity}</td>
                      <td className="col-price">{item.price > 0 ? item.price.toFixed(2) : ''}</td>
                      <td className="col-amount">{item.amount > 0 ? item.amount.toFixed(2) : ''}</td>
                      <td className="col-sign"></td>
                    </tr>
                  ))
                )}
              </tbody>
            <tfoot>
              {/* 本页小计行 */}
              {(() => {
                const pageSubtotalQty = pageItems.reduce((s, it) => s + (it.quantity || 0), 0)
                const pageSubtotalAmt = pageItems.reduce((s, it) => s + (it.amount || 0), 0)
                return (
                  <tr>
                    <td className="total-label" colSpan={2}>本页小计</td>
                    <td className="col-spec"></td>
                    <td className="col-pkg"></td>
                    <td className="col-qty total-qty">{pageSubtotalQty}</td>
                    <td className="col-price"></td>
                    <td className="col-amount total-amount">{pageSubtotalAmt > 0 ? pageSubtotalAmt.toFixed(2) : ''}</td>
                    <td className="col-sign"></td>
                  </tr>
                )
              })()}
              {/* 总计行（最后一页才有） */}
              {isLastPage(pageIndex) && (
                <tr>
                  <td className="total-label" colSpan={2} style={{ fontSize: 13 }}>总计</td>
                  <td className="col-spec"></td>
                  <td className="col-pkg"></td>
                  <td className="col-qty total-qty" style={{ fontSize: 13 }}>{totalQty}</td>
                  <td className="col-price"></td>
                  <td className="col-amount total-amount" style={{ fontSize: 13 }}>{totalAmount > 0 ? totalAmount.toFixed(2) : ''}</td>
                  <td className="col-sign"></td>
                </tr>
              )}
            </tfoot>
          </table>

          {/* 签收区 + 转下页标注 */}
          {isLastPage(pageIndex) ? (
            renderFooter()
          ) : (
            <div style={{ textAlign: 'center', fontSize: 10, color: '#999', marginTop: 6 }}>
              —— 第 {pageIndex + 1}/{pages.length} 页，转下页 ——
            </div>
          )}
            {/* 页码标注 */}
            <div className="page-number">
              第 {pageIndex + 1} 页 / 共 {pages.length} 页
            </div>
          </div></div>
        ))}
      </div>
    </div>
  )
}

export default OrderPrint
