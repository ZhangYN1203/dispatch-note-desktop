import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  searchCustomers, createCustomer, updateCustomer, deleteCustomer,
  getPriceTables,
} from '../utils/ipc'
import type { Customer, PriceTable } from '../types'
import OrderDialog from '../components/OrderDialog'

const CustomerManager: React.FC = () => {
  const navigate = useNavigate()

  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [message, setMessage] = useState('')
  const [modalError, setModalError] = useState('')
  const busy = useRef(false)
  const initialForm = useRef('')
  const search = useRef('')
  const searchVersion = useRef(0)

  // ── Add/Edit Customer dialog ──
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [editCustomerData, setEditCustomerData] = useState<Partial<Customer>>({})
  const [savingCustomer, setSavingCustomer] = useState(false)

  // ── Price tables for dropdown ──
  const [priceTables, setPriceTables] = useState<PriceTable[]>([])

  // ── Delete confirm ──
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  const loadCustomers = useCallback(async (keyword?: string) => {
    const version = ++searchVersion.current
    try {
      const data = await searchCustomers(keyword || undefined)
      if (version === searchVersion.current) setCustomers(data)
    } catch {
      if (version === searchVersion.current) setMessage('客户加载失败，请稍后重试')
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadCustomers()
    getPriceTables().then(tables => { if (active) setPriceTables(tables) }).catch(() => { if (active) setMessage('价格表加载失败，请返回后重试') })
    return () => { active = false; searchVersion.current++ }
  }, [loadCustomers])

  const handleSearch = useCallback((keyword: string) => {
    search.current = keyword
    setCustomerSearch(keyword)
    void loadCustomers(keyword || undefined)
  }, [loadCustomers])

  const openAddCustomer = () => {
    const defaultTableId = priceTables.find(t => t.isDefault)?.id || 0
    const data = { code: '', name: '', address: '', contact: '', phone: '', remark: '', priceTableId: defaultTableId }
    initialForm.current = JSON.stringify(data)
    setEditCustomerData(data)
    setModalError('')
    setShowAddCustomer(true)
  }

  const openEditCustomer = () => {
    if (!selectedCustomer) return
    initialForm.current = JSON.stringify(selectedCustomer)
    setEditCustomerData({ ...selectedCustomer })
    setModalError('')
    setShowEditCustomer(true)
  }

  const closeEditor = () => {
    if (busy.current) return
    if (initialForm.current !== JSON.stringify(editCustomerData) && !window.confirm('客户资料尚未保存，确定放弃本次修改吗？')) return
    setShowAddCustomer(false)
    setShowEditCustomer(false)
    setModalError('')
  }

  const handleSaveCustomer = async () => {
    if (busy.current) return
    const data = { ...editCustomerData, code: editCustomerData.code?.trim() || '', name: editCustomerData.name?.trim() || '', address: editCustomerData.address?.trim() || '' }
    if (!data.code || !data.name || !data.address) { setModalError('客户编码、客户名称、收货地址为必填'); return }
    if (!priceTables.some(table => table.id === data.priceTableId)) { setModalError('请选择有效的关联价格表'); return }
    busy.current = true
    setSavingCustomer(true)
    setModalError('')
    try {
      const matches = await searchCustomers(data.code)
      if (matches.some(customer => customer.code === data.code && customer.id !== (showEditCustomer ? selectedCustomer?.id : undefined))) {
        setModalError('客户编码「' + data.code + '」已存在，请使用其他编码')
        return
      }
      if (showAddCustomer) {
        await createCustomer(data)
        setMessage('客户「' + data.name + '」已添加')
      } else if (selectedCustomer) {
        const result = await updateCustomer(selectedCustomer.id, data)
        if (!result.success) throw new Error(result.message || '客户更新失败')
        setSelectedCustomer({ ...selectedCustomer, ...data, priceTableName: priceTables.find(table => table.id === data.priceTableId)?.name })
        setMessage('客户信息已更新')
      }
      setShowAddCustomer(false)
      setShowEditCustomer(false)
      await loadCustomers(search.current)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setModalError(/UNIQUE.*customers.code/i.test(detail) ? '客户编码已存在，请使用其他编码' : '保存失败：' + detail)
    } finally { busy.current = false; setSavingCustomer(false) }
  }

  const handleDeleteCustomer = async () => {
    if (!deleteTarget || busy.current) return
    busy.current = true
    setSavingCustomer(true)
    setModalError('')
    try {
      const result = await deleteCustomer(deleteTarget.id)
      if (!result.success) throw new Error('客户不存在，请刷新列表')
      setMessage('客户「' + deleteTarget.name + '」已删除')
      setSelectedCustomer(null)
      setDeleteTarget(null)
      await loadCustomers(search.current)
    } catch (error) { setModalError('删除失败：' + (error instanceof Error ? error.message : String(error))) }
    finally { busy.current = false; setSavingCustomer(false) }
  }

  return (
    <div className="page-container customer-manager">
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
          role="status" className="error-message"
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
        <div className="customer-toolbar">
          <div className="customer-search"><input aria-label="搜索客户" value={customerSearch} onChange={event => handleSearch(event.target.value)} placeholder="搜索客户编码、名称..." />
            {customerSearch && <button aria-label="清空客户搜索" onClick={() => handleSearch('')}>×</button>}
          </div>
          <button className="btn btn-sm btn-primary" onClick={openAddCustomer}>+ 添加客户</button>
          <span className="customer-count">{customerSearch ? '匹配' : '共'} {customers.length} 位客户</span>
        </div>
        {customers.length === 0 ? <div className="empty-state"><p>{customerSearch ? '未找到匹配客户' : '暂无客户，请点击“添加客户”'}</p>{customerSearch && <button className="btn" onClick={() => handleSearch('')}>清空搜索</button>}</div> :
          <div className="customer-grid">{customers.map(customer => <div key={customer.id} className="customer-card" role="button" tabIndex={0} aria-haspopup="dialog" aria-label={'查看客户 ' + customer.name} onClick={() => setSelectedCustomer(customer)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedCustomer(customer) }
          }}>
            <div className="customer-card-heading"><strong>{customer.name}</strong><span className="customer-card-code">{customer.code}</span></div>
            <div className="customer-card-address">{customer.address || '未填写地址'}</div>
            {(customer.contact || customer.phone) && <div className="customer-card-contact">{[customer.contact, customer.phone].filter(Boolean).join(' · ')}</div>}
            <div className="customer-card-price">{customer.priceTableName || '未关联价格表'}</div>
          </div>)}</div>}
      </div>

      {selectedCustomer && !showAddCustomer && !showEditCustomer && !deleteTarget && (
        <OrderDialog title="客户详情" className="customer-dialog customer-detail-dialog" onClose={() => setSelectedCustomer(null)} closeOnBackdrop closeLabel="关闭客户详情">
          <div className="customer-identity"><span className="customer-avatar" aria-hidden="true">{selectedCustomer.name.slice(0, 1)}</span><div><h3>{selectedCustomer.name}</h3><span className="customer-code">客户编码 · {selectedCustomer.code}</span></div></div>
          <dl className="customer-details">
            <div className="customer-detail-wide"><dt>收货地址</dt><dd>{selectedCustomer.address || '未填写'}</dd></div>
            <div><dt>联系人</dt><dd>{selectedCustomer.contact || '未填写'}</dd></div>
            <div><dt>联系电话</dt><dd>{selectedCustomer.phone || '未填写'}</dd></div>
            <div className="customer-detail-wide"><dt>关联价格表</dt><dd><span className="customer-price-badge">{selectedCustomer.priceTableName || '未关联'}</span></dd></div>
            {selectedCustomer.remark && <div className="customer-detail-wide"><dt>备注</dt><dd className="customer-remark">{selectedCustomer.remark}</dd></div>}
          </dl>
          <div className="customer-dialog-footer"><button className="btn btn-danger" onClick={() => { setModalError(''); setDeleteTarget(selectedCustomer) }}>删除</button><div className="btn-group"><button className="btn" onClick={() => setSelectedCustomer(null)}>关闭</button><button className="btn btn-primary" onClick={openEditCustomer}>编辑</button></div></div>
        </OrderDialog>
      )}

      {/* ── Add/Edit Customer Dialog ── */}
      {(showAddCustomer || showEditCustomer) && (
        <OrderDialog title={showAddCustomer ? '添加客户' : '编辑客户'} className="confirm-dialog customer-dialog customer-edit-dialog" busy={savingCustomer} onClose={closeEditor} closeOnBackdrop closeLabel={showAddCustomer ? '关闭添加客户' : '关闭编辑客户'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div className="form-field">
                <label htmlFor="customer-field-code">客户编码 *</label>
                <input id="customer-field-code" required
                  value={editCustomerData.code || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, code: e.target.value }))}
                  placeholder="如: 10020"
                  disabled={showEditCustomer || savingCustomer}
                />
              </div>
              <div className="form-field">
                <label htmlFor="customer-field-name">客户名称 *</label>
                <input id="customer-field-name" required
                  disabled={savingCustomer}
                  value={editCustomerData.name || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, name: e.target.value }))}
                  placeholder="如: XX批发部"
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="customer-field-address">收货地址 *</label>
                <input id="customer-field-address" required
                  disabled={savingCustomer}
                  value={editCustomerData.address || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, address: e.target.value }))}
                  placeholder="如: 示例市演示路..."
                />
              </div>
              <div className="form-field">
                <label htmlFor="customer-field-contact">联系人</label>
                <input id="customer-field-contact"
                  disabled={savingCustomer}
                  value={editCustomerData.contact || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, contact: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label htmlFor="customer-field-phone">电话</label>
                <input id="customer-field-phone" type="tel"
                  disabled={savingCustomer}
                  value={editCustomerData.phone || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="customer-field-priceTableId">关联价格表</label>
                <select id="customer-field-priceTableId"
                  disabled={savingCustomer}
                  value={editCustomerData.priceTableId || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, priceTableId: Number(e.target.value) }))}
                >
                  {priceTables.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (默认)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="customer-field-remark">备注</label>
                <textarea id="customer-field-remark"
                  disabled={savingCustomer}
                  value={editCustomerData.remark || ''}
                  onChange={e => setEditCustomerData(p => ({ ...p, remark: e.target.value }))}
                  placeholder="客户特殊要求等..."
                  rows={3}
                />
              </div>
            </div>
            {modalError && <p className="error-message" role="alert">{modalError}</p>}
            <div className="btn-group" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" disabled={savingCustomer} onClick={closeEditor}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveCustomer} disabled={savingCustomer}>
                {savingCustomer ? '保存中...' : '保存'}
              </button>
            </div>
        </OrderDialog>
      )}

      {/* ── Confirm Delete ── */}
      {deleteTarget && (
        <OrderDialog title="确认删除客户" className="confirm-dialog customer-dialog" busy={savingCustomer} onClose={() => setDeleteTarget(null)} closeOnBackdrop closeLabel="关闭删除确认">
          <p>确定要删除客户「{deleteTarget.name}」吗？已保存订单仍保留原客户快照。</p>
          {modalError && <p className="error-message" role="alert">{modalError}</p>}
          <div className="btn-group"><button className="btn" disabled={savingCustomer} onClick={() => setDeleteTarget(null)}>取消</button><button className="btn btn-danger" disabled={savingCustomer} onClick={handleDeleteCustomer}>{savingCustomer ? '删除中...' : '确认'}</button></div>
        </OrderDialog>
      )}
    </div>
  )
}

export default CustomerManager
