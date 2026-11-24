import { orderStatusLabels } from '../../electron/order-status'
import type { OrderStatus } from '../../electron/order-status'
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOrderSummary, saveFile } from '../utils/ipc'
import * as XLSX from 'xlsx'

const OrderSummary: React.FC = () => {
  const navigate = useNavigate()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [details, setDetails] = useState<any[]>([])
  const [summary, setSummary] = useState<any[]>([])
  const [searched, setSearched] = useState(false)

  const handleSearch = async () => {
    if (!dateFrom || !dateTo) {
      setError('请选择开始日期和结束日期')
      return
    }
    if (dateFrom > dateTo) {
      setError('开始日期不能晚于结束日期')
      return
    }
    try {
      setLoading(true)
      setError('')
      const result = await getOrderSummary(dateFrom, dateTo, statusFilter)
      setDetails(result.details)
      setSummary(result.summary)
      setSearched(true)
    } catch (err: any) {
      setError(err.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const exportDetails = async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(details.map((r, i) => ({
      '序号': i + 1,
      '状态': orderStatusLabels[r.status as OrderStatus] || r.status,
      '订单号': r.orderNo || r.documentNo || '',
      '客户编码': r.customerCode,
      '客户名称': r.customerName,
      '商品编码': r.productCode,
      '商品名称': r.productName,
      '数量': r.quantity,
      '单价': r.price,
      '金额': r.amount,
    })))

    // 列宽
    ws['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 16 },
      { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 12 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, '明细')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    await saveFile({ defaultName: `订单明细_${dateFrom}_${dateTo}.xlsx`, buffer: Array.from(new Uint8Array(buf)) })
  }

  const exportSummary = async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(summary.map((r, i) => ({
      '序号': i + 1,
      '客户编码': r.customerCode,
      '客户名称': r.customerName,
      '商品编码': r.productCode,
      '商品名称': r.productName,
      '汇总数量': r.totalQty,
      '汇总金额': r.totalAmt,
    })))

    ws['!cols'] = [
      { wch: 6 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 12 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, '合计')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    await saveFile({ defaultName: `订单合计_${dateFrom}_${dateTo}.xlsx`, buffer: Array.from(new Uint8Array(buf)) })
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>订单汇总查询</h1>
        <div className="btn-group">
          <button className="btn" onClick={() => navigate('/')}>
            ← 返回列表
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <p>按订单日期汇总，默认包含未发货单但不含作废单。可选择“已发货”查看已发货订单口径，实际库存以库存流水为准。</p>
      <label>状态 <select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setSearched(false); setDetails([]); setSummary([]) }}><option value="">有效订单（不含作废）</option>{Object.entries(orderStatusLabels).filter(([key]) => key !== 'voided').map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {/* 时间段选择 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ minWidth: 160 }}>
            <label>开始日期</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ minWidth: 160 }}>
            <label>结束日期</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
      </div>

      {searched && !loading && (
        <>
          {/* ── 详情表 ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>详情表</h2>
              <div className="btn-group">
                <span style={{ fontSize: 13, color: '#888', marginRight: 8 }}>
                  共 {details.length} 条记录
                </span>
                {details.length > 0 && (
                  <button className="btn btn-sm btn-primary" onClick={exportDetails}>
                    导出 Excel
                  </button>
                )}
              </div>
            </div>
            {details.length === 0 ? (
              <div className="empty-state"><p>该时间段无订单数据</p></div>
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 480 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>序号</th>
                      <th>订单号</th>
                      <th style={{ width: 100 }}>客户编码</th>
                      <th>客户名称</th>
                      <th style={{ width: 100 }}>商品编码</th>
                      <th>商品名称</th>
                      <th style={{ width: 70, textAlign: 'center' }}>数量</th>
                      <th style={{ width: 90, textAlign: 'right' }}>单价</th>
                      <th style={{ width: 100, textAlign: 'right' }}>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{r.orderNo || r.documentNo || '-'}</td>
                        <td>{r.customerCode || '-'}</td>
                        <td>{r.customerName || '-'}</td>
                        <td>{r.productCode || '-'}</td>
                        <td>{r.productName || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{r.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{r.price.toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{r.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 合计表 ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>合计表</h2>
              <div className="btn-group">
                <span style={{ fontSize: 13, color: '#888', marginRight: 8 }}>
                  共 {summary.length} 条记录
                </span>
                {summary.length > 0 && (
                  <button className="btn btn-sm btn-primary" onClick={exportSummary}>
                    导出 Excel
                  </button>
                )}
              </div>
            </div>
            {summary.length === 0 ? (
              <div className="empty-state"><p>该时间段无订单数据</p></div>
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 480 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>序号</th>
                      <th style={{ width: 100 }}>客户编码</th>
                      <th>客户名称</th>
                      <th style={{ width: 100 }}>商品编码</th>
                      <th>商品名称</th>
                      <th style={{ width: 80, textAlign: 'center' }}>汇总数量</th>
                      <th style={{ width: 100, textAlign: 'right' }}>汇总金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{r.customerCode || '-'}</td>
                        <td>{r.customerName || '-'}</td>
                        <td>{r.productCode || '-'}</td>
                        <td>{r.productName || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{r.totalQty}</td>
                        <td style={{ textAlign: 'right' }}>{r.totalAmt.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default OrderSummary
