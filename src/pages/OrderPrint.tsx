import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOrderById, getPrintSettings, setPrintSettings, printWindow } from '../utils/ipc'
import type { Order, OrderItem } from '../types'
import '../styles/print.css'

const ROWS_PER_PAGE = 10

const OrderPrint: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const printRef = useRef<HTMLDivElement>(null)

  const [order, setOrder] = useState<(Order & { items: OrderItem[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printError, setPrintError] = useState('')
  const [pageHeight, setPageHeight] = useState(95)
  const [settingsReady, setSettingsReady] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE)
  const [layoutError, setLayoutError] = useState('')
  const printBusy = useRef(false)

  useEffect(() => {
    let alive = true
    getPrintSettings().then(settings => {
      if (!alive) return
      const height = Number(settings.printPageHeight || 95)
      setPageHeight(Number.isInteger(height) && height >= 70 && height <= 150 ? height : 95)
      setSettingsReady(true)
    }).catch(error => { if (alive) setPrintError('加载打印设置失败：' + error.message) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!settingsReady) return
    const timer = window.setTimeout(() => {
      void setPrintSettings({ printPageHeight: String(pageHeight) }).catch(error => setPrintError(error.message))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [pageHeight, settingsReady])

  useEffect(() => {
    document.documentElement.style.setProperty('--page-height', `${pageHeight}mm`)
    // @page size cannot rely on CSS custom properties in all Chromium versions.
    const style = document.createElement('style')
    style.textContent = `@page { size: 240mm ${pageHeight}mm; margin: 0; }`
    document.head.appendChild(style)
    return () => {
      style.remove()
      document.documentElement.style.removeProperty('--page-height')
    }
  }, [pageHeight])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError('')
    fetchOrderById(Number(id))
      .then(data => {
        if (!data) {
          setError('订单不存在')
          return
        }
        setOrder(data)
      })
      .catch((err: any) => setError(err.message || '加载订单失败'))
      .finally(() => setLoading(false))
  }, [id])

  useLayoutEffect(() => { setRowsPerPage(ROWS_PER_PAGE) }, [pageHeight, order])
  useLayoutEffect(() => {
    if (!order || !printRef.current) return
    const measure = () => {
      const allowed = pageHeight * 96 / 25.4 - 2
      const overflowing = Array.from(printRef.current?.querySelectorAll<HTMLElement>('.print-page') || []).some(page => {
        const last = page.lastElementChild
        return last && last.getBoundingClientRect().bottom - page.getBoundingClientRect().top > allowed
      })
      if (overflowing && rowsPerPage > 1) setRowsPerPage(rowsPerPage - 1)
      setLayoutError(overflowing && rowsPerPage === 1 ? '内容超出当前纸张高度，请增大纸张高度或缩短过长字段。' : '')
    }
    measure()
    let active = true
    void document.fonts.ready.then(() => { if (active) measure() })
    return () => { active = false }
  }, [rowsPerPage, pageHeight, order])

  const handlePrint = useCallback(async () => {
    if (printBusy.current || !settingsReady || !order || layoutError) return
    printBusy.current = true
    setPrinting(true)
    setPrintError('')
    try {
      await setPrintSettings({ printPageHeight: String(pageHeight) })
      await document.fonts.ready
      await printWindow()
    } catch (error: unknown) {
      setPrintError(error instanceof Error ? error.message : String(error))
    } finally { printBusy.current = false; setPrinting(false) }
  }, [pageHeight, settingsReady, order, layoutError])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void handlePrint()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlePrint])

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载中...</div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="page-container">
        <div className="error-message">{error || '订单不存在'}</div>
        <button className="btn" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
    )
  }

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
      {/* Non-printable toolbar */}
      <div className="no-print toolbar">
        <button className="btn" onClick={() => navigate('/')}>
          ← 返回列表
        </button>
        <button className="btn" onClick={() => navigate(`/orders/${id}`)}>
          编辑订单
        </button>
        <button className="btn btn-primary" disabled={printing || !settingsReady || !!layoutError} onClick={handlePrint}>
          {printing ? '正在打印…' : '打印 (Ctrl+P)'}
        </button>
        <label className="print-height-control">
          纸张高度
          <input aria-label="纸张高度" type="range" min="70" max="150" step="1" value={pageHeight}
            disabled={printing || !settingsReady} onChange={event => setPageHeight(Number(event.target.value))} />
          {pageHeight} mm
        </label>
      </div>
      {(printError || layoutError) && <div role="alert" className="error-message no-print">{printError || layoutError}</div>}

      {/* Print area */}
      <div className="print-area" ref={printRef}>
        {pages.map((pageItems, pageIndex) => (
          <div key={pageIndex} className="print-page">
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
          </div>
        ))}
      </div>
    </div>
  )
}

export default OrderPrint
