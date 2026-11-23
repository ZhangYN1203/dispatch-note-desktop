import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  searchCustomers, createCustomer, updateCustomer, deleteCustomer,
  getPriceTables,
} from '../utils/ipc'
import type { Customer, PriceTable } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

const CustomerManager: React.FC = () => {
  const navigate = useNavigate()

  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [message, setMessage] = useState('')

  // ── Add/Edit Customer dialog ──
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [editCustomerData, setEditCustomerData] = useState<Partial<Customer>>({})
  const [savingCustomer, setSavingCustomer] = useState(false)

  // ── Price tables for dropdown ──
  const [priceTables, setPriceTables] = useState<PriceTable[]>([])

  // ── Delete confirm ──
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  useEffect(() => {
    loadCustomers()
    getPriceTables().then(setPriceTables).catch(() => {})
  }, [])

  const loadCustomers = async (keyword?: string) => {
    try {
      const data = await searchCustomers(keyword || undefined)
      setCustomers(data)
    } catch (_) {}
  }

  const handleSearch = useCallback((keyword: string) => {
    setCustomerSearch(keyword)
    loadCustomers(keyword || undefined)
  }, [])

  const openAddCustomer = () => {
    const defaultTableId = priceTables.find(t => t.isDefault)?.id || 0
    setEditCustomerData({ code: '', name: '', address: '', contact: '', phone: '', remark: '', priceTableId: defaultTableId })
    setShowAddCustomer(true)
  }

  const openEditCustomer = () => {
    if (!selectedCustomer) return
    setEditCustomerData({ ...selectedCustomer })
    setShowEditCustomer(true)
  }

  const handleSaveCustomer = async () => {
    if (!editCustomerData.code || !editCustomerData.name || !editCustomerData.address) {
      setMessage('客户编码、客户名称、收货地址为必填')
      return
    }
    try {
      setSavingCustomer(true)
      if (showAddCustomer) {
        await createCustomer({ ...editCustomerData as any })
        setMessage(`客户 ${editCustomerData.name} 已添加`)
        await loadCustomers()
      } else if (showEditCustomer && selectedCustomer) {
        await updateCustomer(selectedCustomer.id, editCustomerData)
        setMessage(`客户信息已更新`)
        await loadCustomers()
        const updated = await searchCustomers(editCustomerData.code || '')
        if (updated.length > 0) {
          setSelectedCustomer(updated[0])
        }
      }
      setShowAddCustomer(false)
      setShowEditCustomer(false)
    } catch (err: any) {
      setMessage(`操作失败: ${err.message}`)
    } finally {
      setSavingCustomer(false)
    }
  }

  const handleDeleteCustomer = async () => {
    if (!deleteTarget) return
    try {
      await deleteCustomer(deleteTarget.id)
      setMessage(`客户 ${deleteTarget.name} 已删除`)
      setSelectedCustomer(null)
      setDeleteTarget(null)
      await loadCustomers()
    } catch (err: any) {
      setMessage(`删除失败: ${err.message}`)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>客户管理</h1>
        <div className="btn-group">
          <button className="btn" onClick={() => navigate('/')}>
            ← 返回
          </button>
        </div>
      </div>

      {message && (
        <div
          className="error-message"
          style={{
            background: message.includes('失败') ? '#fff2f0' : '#f6ffed',
            borderColor: message.includes('失败') ? '#ffccc7' : '#b7eb8f',
            color: message.includes('失败') ? '#ff4d4f' : '#52c41a',
          }}
        >
          {message}
          <button
            style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}
            onClick={() => setMessage('')}
          >
            ×
          </button>
        </div>
      )}

      <div className="form-container">
        {/* ── 客户搜索 ── */}
        <div className="form-section">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <input
              value={customerSearch}
              onChange={e => handleSearch(e.target.value)}
              placeholder="搜索客户编码、名称..."
              style={{ flex: 1, maxWidth: 400, padding: '7px 11px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, outline: 'none' }}
            />
            <button className="btn btn-sm btn-primary" onClick={openAddCustomer}>
              + 添加客户
            </button>
          </div>

          {!selectedCustomer ? (
            <div>
              {customers.length === 0 ? (
                <div className="empty-state"><p>{customerSearch ? '未找到匹配客户' : '暂无客户，请点击"添加客户"'}</p></div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                  {customers.map(c => (
                    <div
                      key={c.id}
                      style={{
                        padding: '14px 16px', background: '#fff', border: '1px solid #e8e8e8',
                        borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onClick={() => setSelectedCustomer(c)}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1677ff'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(22,119,255,0.15)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e8e8e8'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                        [{c.code}] {c.address}
                      </div>
                      {(c.contact || c.phone) && (
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {c.contact ? `联系人: ${c.contact}` : ''}{c.phone ? ` ${c.phone}` : ''}
                        </div>
                      )}
                      {c.priceTableName && (
                        <div style={{ fontSize: 12, color: '#1677ff', marginTop: 2 }}>
                          价格表: {c.priceTableName}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{
                padding: '12px 16px', background: '#f5f9ff',
                border: '1px solid #d6e4ff', borderRadius: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{selectedCustomer.name}</strong>
                    <span style={{ marginLeft: 12, color: '#888', fontSize: 13 }}>
                      [{selectedCustomer.code}]
                    </span>
                  </div>
                  <div className="btn-group">
                    <button className="btn btn-sm" onClick={() => setSelectedCustomer(null)}>
                      ← 返回
                    </button>
                    <button className="btn btn-sm" onClick={openEditCustomer}>编辑</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(selectedCustomer)}>删除</button>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                  <div>{selectedCustomer.address}</div>
                  {(selectedCustomer.contact || selectedCustomer.phone) && (
                    <div>联系人: {selectedCustomer.contact || '-'} | {selectedCustomer.phone || '-'}</div>
                  )}
                  {selectedCustomer.priceTableName && (
                    <div style={{ color: '#1677ff', marginTop: 2 }}>价格表: {selectedCustomer.priceTableName}</div>
                  )}
                  {selectedCustomer.remark && <div style={{ marginTop: 2, color: '#999' }}>备注: {selectedCustomer.remark}</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add/Edit Customer Dialog ── */}
      {(showAddCustomer || showEditCustomer) && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 500 }}>
            <h3>{showAddCustomer ? '添加客户' : '编辑客户'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div className="form-field">
                <label>客户编码 *</label>
                <input
                  value={editCustomerData.code || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, code: e.target.value }))}
                  placeholder="如: 10020"
                  disabled={showEditCustomer}
                />
              </div>
              <div className="form-field">
                <label>客户名称 *</label>
                <input
                  value={editCustomerData.name || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, name: e.target.value }))}
                  placeholder="如: XX批发部"
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>收货地址 *</label>
                <input
                  value={editCustomerData.address || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, address: e.target.value }))}
                  placeholder="如: 示例市演示路..."
                />
              </div>
              <div className="form-field">
                <label>联系人</label>
                <input
                  value={editCustomerData.contact || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, contact: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label>电话</label>
                <input
                  value={editCustomerData.phone || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>关联价格表</label>
                <select
                  value={editCustomerData.priceTableId || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, priceTableId: Number(e.target.value) }))}
                >
                  {priceTables.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (默认)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>备注</label>
                <textarea
                  value={editCustomerData.remark || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, remark: e.target.value }))}
                  placeholder="客户特殊要求等..."
                  rows={3}
                />
              </div>
            </div>
            <div className="btn-group" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setShowAddCustomer(false); setShowEditCustomer(false) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveCustomer} disabled={savingCustomer}>
                {savingCustomer ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete ── */}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除客户"
          message={`确定要删除客户「${deleteTarget.name}」吗？`}
          onConfirm={handleDeleteCustomer}
          onCancel={() => setDeleteTarget(null)}
          confirmText="确认"
          danger
        />
      )}
    </div>
  )
}

export default CustomerManager
