import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation, useBlocker, Navigate } from 'react-router-dom'
import {
  fetchOrderById, saveOrderWithItems,
  searchProducts, searchCustomers, getCustomerPrices,
  generateDocumentNo,
} from '../utils/ipc'
import OrderStatusPanel from '../components/OrderStatusPanel'
import type { Order, OrderItem, Product, Customer, CustomerPrice } from '../types'

interface EditableItem {
  _tempId: number
  id?: number
  productCode: string
  productName: string
  specification: string
  packageSpec: string
  unit: string
  quantity: number
  price: number
  amount: number
  remark: string
}

let tempIdCounter = 0

function createEmptyItem(): EditableItem {
  tempIdCounter -= 1
  return {
    _tempId: tempIdCounter,
    productCode: '',
    productName: '',
    specification: '',
    packageSpec: '',
    unit: '件',
    quantity: 1,
    price: 0,
    amount: 0,
    remark: '',
  }
}

const emptyOrder: Partial<Order> = {
  documentNo: '',
  orderNo: '',
  date: new Date().toISOString().slice(0, 10),
  sender: '示例发货单位（虚构）',
  senderPhone: '',
  receiver: '',
  receiverContact: '',
  receiverPhone: '',
  receiverAddress: '',
  carrierVehicle: '',
  carrierName: '',
  warehouse: '成品库',
  outTime: '',
  tonnage: '',
  mileage: '',
  maker: '',
  reviewer: '',
  remark: '',
}

const productListCache: Product[] = []

const OrderEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isNew = !id || id === 'new'

  const [order, setOrder] = useState<Partial<Order>>({ ...emptyOrder })
  const [items, setItems] = useState<EditableItem[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [defaultsNotice, setDefaultsNotice] = useState('')
  const clean = useRef('')
  const serialized = JSON.stringify([order, items])
  const dirty = useRef(false)
  dirty.current = !!clean.current && clean.current !== serialized
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [orderId, setOrderId] = useState<number | null>(null)

  // ── Customer info (bound together) ──
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerCodeSearch, setCustomerCodeSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  // ── Product search state ──
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null)

  // ── Customer prices cache ──
  const [customerPriceMap, setCustomerPriceMap] = useState<Record<string, number>>({})

  const productInputRef = useRef<HTMLInputElement>(null)

  const blocker = useBlocker(() => dirty.current && !savingRef.current)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('订单尚未保存，确定放弃修改并离开吗？')) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  useEffect(() => {
    if (!loading && !clean.current) clean.current = serialized
  }, [loading, serialized])
  useEffect(() => {
    if (!isNew) return
    let active = true
    const source = (location.state as { copyFrom?: number } | null)?.copyFrom
    setLoading(true)
    Promise.all([window.electronAPI.getOrderDefaults(), generateDocumentNo(), source ? fetchOrderById(source) : Promise.resolve(null)])
      .then(async ([defaults, number, data]) => {
        if (!active) return
        setLocked(false); setOrderId(null)
        setOrder({ ...emptyOrder, ...defaults, ...(data || {}), id: undefined, documentNo: number, orderNo: '', date: new Date().toLocaleDateString('sv-SE') })
        setItems(data?.items.map(item => ({ ...item, id: undefined, _tempId: --tempIdCounter, packageSpec: item.packageSpec || '' })) || [])
        clean.current = source ? 'copied-unsaved' : ''
        if (data) { const customers = await searchCustomers(data.receiver); if (active && customers[0]) { setSelectedCustomer(customers[0]); setCustomerCodeSearch(`${customers[0].code} - ${customers[0].name}`); const prices = await getCustomerPrices(customers[0].code); if (active) setCustomerPriceMap(Object.fromEntries(prices.map(price => [price.productCode, price.price]))) } }
      }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isNew, location.state])
  // ── Load all customers on mount ──
  useEffect(() => {
    searchCustomers('').then(setCustomerResults).catch(() => {})
  }, [])

  // ── Customer search ──
  const handleCustomerSearch = useCallback(async (keyword: string) => {
    setCustomerCodeSearch(keyword)
    try {
      const results = await searchCustomers(keyword || undefined)
      setCustomerResults(results)
      setShowCustomerDropdown(true)
    } catch (err) {
      console.error('搜索客户失败:', err)
    }
  }, [])

  const selectCustomer = useCallback(async (customer: Customer) => {
    setSelectedCustomer(customer)
    setCustomerCodeSearch(`${customer.code} - ${customer.name}`)
    setShowCustomerDropdown(false)
    setOrder(prev => ({
      ...prev,
      receiver: customer.name,
      receiverContact: customer.contact || '',
      receiverPhone: customer.phone || '',
      receiverAddress: customer.address || '',
    }))

    // Clear items when switching customer
    setItems([])

    try {
      const prices = await getCustomerPrices(customer.code)
      const priceMap: Record<string, number> = {}
      prices.forEach((p: CustomerPrice) => {
        priceMap[p.productCode] = p.price
      })
      setCustomerPriceMap(priceMap)
    } catch (err) {
      console.error('加载客户价格失败:', err)
    }
  }, [])

  // ── Product search (triggered on every keystroke) ──
  const handleProductSearch = useCallback(async (keyword: string) => {
    setProductSearch(keyword)
    try {
      const results = keyword.trim()
        ? await searchProducts(keyword)
        : await searchProducts('') // empty -> return all
      setProductResults(results.slice(0, 80))
      setShowProductDropdown(true)
    } catch (err) {
      console.error('搜索产品失败:', err)
    }
  }, [])

  const selectProduct = useCallback((index: number, product: Product) => {
    // Check for duplicate product in the order (skip the current index being edited)
    setItems(prev => {
      const duplicate = prev.find((it, i) => i !== index && it.productCode === product.productCode)
      if (duplicate) {
        setError(`商品「${product.productName}」已在订单中，不能重复添加`)
        return prev
      }
      setError('')
      const price = customerPriceMap[product.productCode] ?? product.price
      const newItems = [...prev]
      const item = { ...newItems[index] }
      item.productCode = product.productCode
      item.productName = product.productName
      item.specification = product.specification
      item.packageSpec = product.packageSpec || ''
      item.unit = product.unit
      item.price = price
      item.amount = Math.round((item.quantity || 0) * price * 100) / 100
      newItems[index] = item
      return newItems
    })
    setProductSearch('')
    setProductResults([])
    setShowProductDropdown(false)
    setActiveItemIndex(null)
  }, [customerPriceMap])

  const loadOrder = useCallback(async () => {
    if (!id || id === 'new') return
    try {
      setLoading(true)
      setError('')
      const data = await fetchOrderById(Number(id))
      if (!data) {
        setError('订单不存在')
        return
      }

      let matchedCustomer: Customer | null = null
      if (data.receiver) {
        const custs = await searchCustomers(data.receiver)
        if (custs.length > 0) matchedCustomer = custs[0]
      }

      setOrder({
        documentNo: data.documentNo,
        orderNo: data.orderNo,
        date: data.date,
        sender: data.sender,
        senderPhone: data.senderPhone,
        receiver: data.receiver,
        receiverContact: data.receiverContact,
        receiverPhone: data.receiverPhone,
        receiverAddress: data.receiverAddress,
        carrierVehicle: data.carrierVehicle,
        carrierName: data.carrierName,
        warehouse: data.warehouse,
        outTime: data.outTime,
        tonnage: data.tonnage,
        mileage: data.mileage,
        maker: data.maker,
        reviewer: data.reviewer,
        remark: data.remark,
      })

      if (matchedCustomer) {
        setSelectedCustomer(matchedCustomer)
        setCustomerCodeSearch(`${matchedCustomer.code} - ${matchedCustomer.name}`)
        try {
          const prices = await getCustomerPrices(matchedCustomer.code)
          const priceMap: Record<string, number> = {}
          prices.forEach((p: CustomerPrice) => {
            priceMap[p.productCode] = p.price
          })
          setCustomerPriceMap(priceMap)
        } catch (_) {}
      }

      clean.current = ''
      setLocked(data.status !== 'draft')
      setOrderId(data.id)
      setItems(
        data.items.map((it: OrderItem) => ({
          _tempId: --tempIdCounter,
          id: it.id,
          productCode: it.productCode,
          productName: it.productName,
          specification: it.specification,
          packageSpec: (it as any).packageSpec || '',
          unit: it.unit,
          quantity: it.quantity,
          price: it.price,
          amount: it.amount,
          remark: it.remark,
        }))
      )
    } catch (err: any) {
      setError(err.message || '加载订单失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadOrder()
  }, [loadOrder])

  const updateField = (field: string, value: string) => {
    setOrder(prev => ({ ...prev, [field]: value }))
  }

  const updateItem = (tempId: number, field: keyof EditableItem, value: string | number) => {
    setItems(prev =>
      prev.map(it => {
        if (it._tempId !== tempId) return it
        const updated = { ...it, [field]: value }
        if (field === 'quantity' || field === 'price') {
          const qty = field === 'quantity' ? Number(value) : it.quantity
          const prc = field === 'price' ? Number(value) : it.price
          updated.amount = Math.round(qty * prc * 100) / 100
        }
        return updated
      })
    )
  }

  const addItem = () => {
    const newItem = createEmptyItem()
    const newIndex = items.length
    setItems(prev => [...prev, newItem])
    // Open product selector for the new row
    setTimeout(() => {
      setActiveItemIndex(newIndex)
      setProductSearch('')
      handleProductSearch('') // load all products
      if (productInputRef.current) productInputRef.current.focus()
    }, 100)
  }

  const removeItem = (tempId: number) => {
    setItems(prev => prev.filter(it => it._tempId !== tempId))
  }

  const handleSave = async () => {
    if (savingRef.current) return
    if (!isNew && !orderId) { setError('订单尚未加载完成，无法保存'); return }
    savingRef.current = true
    try {
      setSaving(true)
      setError('')

      const dataToSave = {
        ...order,
        date: order.date || new Date().toISOString().slice(0, 10),
      }

      await saveOrderWithItems(dataToSave, items, isNew ? undefined : orderId ?? undefined)
      clean.current = JSON.stringify([order, items]); dirty.current = false
      navigate('/')
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const totalAmount = items.reduce((sum, it) => sum + (it.amount || 0), 0)
  const totalQuantity = items.reduce((sum, it) => sum + (it.quantity || 0), 0)

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载中...</div>
      </div>
    )
  }

  if (locked) return <Navigate to={`/orders/${id}/view`} replace />

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{isNew ? '新建订单' : '编辑订单'}</h1>
        <div className="btn-group">
          <button className="btn" onClick={() => navigate('/')}>
            返回列表
          </button>
          <button className="btn" onClick={() => navigate('/product-manager')}>
            价格管理
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存订单'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <OrderStatusPanel status="draft" />
      {!isNew && <div className="order-state-actions"><button className="btn" onClick={() => navigate(`/orders/${id}/view`)}>查看详情与状态操作</button></div>}
      <div className="form-container">
        <div className="form-section order-essential">
          <h2>客户与开单信息</h2>
          <div className="form-grid">
            {/* Customer selector */}
            <div className="form-field" style={{ position: 'relative' }}>
              <label>客户编码</label>
              <input
                value={customerCodeSearch}
                onChange={e => handleCustomerSearch(e.target.value)}
                onFocus={() => {
                  if (customerCodeSearch) handleCustomerSearch(customerCodeSearch)
                  else {
                    setShowCustomerDropdown(true)
                    handleCustomerSearch('')
                  }
                }}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                placeholder="输入客户编码或名称搜索"
              />
              {showCustomerDropdown && (
                <div className="dropdown-menu" style={{ width: 450, maxHeight: 350 }}>
                  {customerResults.length === 0 ? (
                    <div className="dropdown-item" style={{ color: '#999' }}>
                      {customerCodeSearch ? '未找到匹配客户' : '加载中...'}
                    </div>
                  ) : (
                    customerResults.map(c => (
                      <div
                        key={c.id}
                        className="dropdown-item"
                        onMouseDown={() => selectCustomer(c)}
                      >
                        <div className="dropdown-item-primary">
                          [{c.code}] {c.name}
                        </div>
                        <div className="dropdown-item-secondary">
                          {c.address || '无地址'} {c.phone ? `| ${c.phone}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <label className="form-field">收货单位<input aria-label="收货单位" type="text" value={order.receiver || ''} readOnly /></label>
            <label className="form-field">日期<input aria-label="日期" type="date" value={order.date || ''} onChange={e => updateField('date', e.target.value)} /></label>
            <label className="form-field">单据编号<input aria-label="单据编号" type="text" value={order.documentNo || ''} readOnly /></label>
            <label className="form-field">订单号<input aria-label="订单号" type="text" value={order.orderNo || ''} onChange={e => updateField('orderNo', e.target.value)} /></label>
            <label className="form-field">发货单位<input aria-label="发货单位" type="text" value={order.sender || ''} onChange={e => updateField('sender', e.target.value)} /></label>
            <label className="form-field">发货电话<input aria-label="发货电话" type="text" value={order.senderPhone || ''} onChange={e => updateField('senderPhone', e.target.value)} /></label>
            <label className="form-field">发货仓库<input aria-label="发货仓库" type="text" value={order.warehouse || ''} onChange={e => updateField('warehouse', e.target.value)} /></label>
            <label className="form-field">制单人<input aria-label="制单人" type="text" value={order.maker || ''} onChange={e => updateField('maker', e.target.value)} /></label>
            <label className="form-field">收货地址<input aria-label="收货地址" type="text" value={order.receiverAddress || ''} readOnly /></label>
            <label className="form-field">收货联系人<input aria-label="收货联系人" type="text" value={order.receiverContact || ''} readOnly /></label>
            <label className="form-field">收货电话<input aria-label="收货电话" type="text" value={order.receiverPhone || ''} readOnly /></label>
          </div>
          <div className="order-default-actions">
            <button className="btn btn-sm" onClick={async () => {
              try {
                await window.electronAPI.saveOrderDefaults({ sender: order.sender || '', senderPhone: order.senderPhone || '', warehouse: order.warehouse || '', maker: order.maker || '' })
                setDefaultsNotice('已保存，下一张新订单将使用这些默认值。')
              } catch (error) { setError((error as Error).message) }
            }}>保存为开单默认值</button>
            <span role="status">{defaultsNotice || '只保存发货单位、发货电话、仓库和制单人，不保存客户与商品。'}</span>
          </div>
        </div>
        <details className="form-section order-more">
          <summary>运输、签收与备注（可选）</summary><div className="form-grid">
            <label className="form-field">承运车号<input aria-label="承运车号" type="text" value={order.carrierVehicle || ''} onChange={e => updateField('carrierVehicle', e.target.value)} /></label>
            <label className="form-field">承运人<input aria-label="承运人" type="text" value={order.carrierName || ''} onChange={e => updateField('carrierName', e.target.value)} /></label>
            <label className="form-field">出厂时间<input aria-label="出厂时间" type="datetime-local" value={order.outTime || ''} onChange={e => updateField('outTime', e.target.value)} /></label>
            <label className="form-field">吨位<input aria-label="吨位" type="text" value={order.tonnage || ''} onChange={e => updateField('tonnage', e.target.value)} /></label>
            <label className="form-field">里程<input aria-label="里程" type="text" value={order.mileage || ''} onChange={e => updateField('mileage', e.target.value)} /></label>
            <label className="form-field">复核<input aria-label="复核" type="text" value={order.reviewer || ''} onChange={e => updateField('reviewer', e.target.value)} /></label>
            <label className="form-field">备注<input aria-label="备注" type="text" value={order.remark || ''} onChange={e => updateField('remark', e.target.value)} /></label>
          </div>
        </details>

        {/* ── Items Section ── */}
        <div className="form-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ border: 'none', margin: 0, padding: 0 }}>商品明细</h2>
            <button className="btn btn-sm btn-primary" onClick={addItem} disabled={!selectedCustomer}>
              + 添加商品
            </button>
            {!selectedCustomer && (
              <span style={{ color: '#999', fontSize: 12 }}>请先选择客户</span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>
              <p>{selectedCustomer ? '暂无商品，请点击"添加商品"' : '请先在上方选择客户，然后添加商品'}</p>
            </div>
          ) : (
            <div className="items-editor">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>序号</th>
                    <th style={{ minWidth: 200 }}>商品选择</th>
                    <th>规格</th>
                    <th style={{ width: 80 }}>箱规格</th>
                    <th style={{ width: 60 }}>单位</th>
                    <th style={{ width: 90 }}>数量</th>
                    <th style={{ width: 100 }}>单价</th>
                    <th style={{ width: 100 }}>金额</th>
                    <th>备注</th>
                    <th style={{ width: 50 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item._tempId}>
                      <td>{index + 1}</td>
                      <td style={{ position: 'relative', minWidth: 280 }}>
                        {/* Product selector with search input + dropdown trigger */}
                        <div style={{ display: 'flex', gap: 0 }}>
                          <input
                            ref={index === activeItemIndex ? productInputRef : undefined}
                            style={{
                              flex: 1,
                              padding: '6px 10px',
                              border: activeItemIndex === index
                                ? '2px solid #1677ff'
                                : '1px solid #d9d9d9',
                              borderRadius: '6px 0 0 6px',
                              fontSize: 13,
                              outline: 'none',
                              background: activeItemIndex === index ? '#fff' : '#f9f9f9',
                              fontWeight: item.productName ? 500 : 400,
                            }}
                            value={
                              activeItemIndex === index
                                ? productSearch
                                : item.productName
                                  ? `${item.productCode} - ${item.productName}`
                                  : ''
                            }
                            placeholder="搜索商品编码/名称..."
                            onChange={e => {
                              if (activeItemIndex !== index) {
                                setActiveItemIndex(index)
                              }
                              handleProductSearch(e.target.value)
                            }}
                            onFocus={() => {
                              setActiveItemIndex(index)
                              if (!productResults.length) {
                                handleProductSearch(productSearch || '')
                              }
                              setShowProductDropdown(true)
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                if (activeItemIndex === index) {
                                  setShowProductDropdown(false)
                                }
                              }, 200)
                            }}
                          />
                          <button
                            style={{
                              padding: '4px 10px',
                              background: activeItemIndex === index ? '#1677ff' : '#f0f0f0',
                              color: activeItemIndex === index ? '#fff' : '#666',
                              border: activeItemIndex === index
                                ? '2px solid #1677ff'
                                : '1px solid #d9d9d9',
                              borderLeft: 'none',
                              borderRadius: '0 6px 6px 0',
                              cursor: 'pointer',
                              fontSize: 16,
                              lineHeight: '24px',
                            }}
                            onMouseDown={e => {
                              e.preventDefault()
                              setActiveItemIndex(index)
                              if (showProductDropdown) {
                                setShowProductDropdown(false)
                              } else {
                                handleProductSearch(productSearch || '')
                              }
                            }}
                          >
                            ▼
                          </button>
                        </div>

                        {/* Dropdown */}
                        {activeItemIndex === index && showProductDropdown && (
                          <div
                            className="product-selector-dropdown"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              zIndex: 100,
                              background: '#fff',
                              border: '2px solid #1677ff',
                              borderRadius: '0 0 8px 8px',
                              boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                              maxHeight: 340,
                              overflow: 'auto',
                              marginTop: 2,
                              minWidth: 400,
                            }}
                          >
                            {productResults.length === 0 ? (
                              <div style={{ padding: '16px 14px', color: '#999', textAlign: 'center' }}>
                                {productSearch ? '未找到匹配商品' : '暂无商品数据'}
                              </div>
                            ) : (
                              <>
                                {/* Header row */}
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: '80px 1.5fr 100px',
                                  gap: 8,
                                  padding: '8px 12px',
                                  background: '#f5f9ff',
                                  borderBottom: '1px solid #e8e8e8',
                                  fontSize: 12,
                                  color: '#666',
                                  fontWeight: 600,
                                  position: 'sticky',
                                  top: 0,
                                  zIndex: 1,
                                }}>
                                  <span>编码</span>
                                  <span>商品名称</span>
                                  <span style={{ textAlign: 'center' }}>规格</span>
                                </div>
                                {productResults.map(p => (
                                  <div
                                    key={p.id}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '80px 1.5fr 100px',
                                      gap: 8,
                                      padding: '9px 12px',
                                      cursor: 'pointer',
                                      borderBottom: '1px solid #f5f5f5',
                                      transition: 'background 0.1s',
                                      alignItems: 'center',
                                    }}
                                    onMouseDown={() => selectProduct(index, p)}
                                    onMouseEnter={e => {
                                      (e.currentTarget as HTMLElement).style.background = '#f0f5ff'
                                    }}
                                    onMouseLeave={e => {
                                      (e.currentTarget as HTMLElement).style.background = ''
                                    }}
                                  >
                                    <span style={{ fontSize: 12, color: '#888' }}>{p.productCode}</span>
                                    <span style={{ fontWeight: 500, fontSize: 13 }}>{p.productName}</span>
                                    <span style={{ textAlign: 'center', fontSize: 12, color: '#666' }}>{p.specification}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          value={item.specification}
                          onChange={e => updateItem(item._tempId, 'specification', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={item.packageSpec}
                          onChange={e => updateItem(item._tempId, 'packageSpec', e.target.value)}
                          readOnly
                          style={{ background: '#f5f5f5', color: '#666' }}
                        />
                      </td>
                      <td>
                        <input
                          value={item.unit}
                          onChange={e => updateItem(item._tempId, 'unit', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="num-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantity || ''}
                          onChange={e => updateItem(item._tempId, 'quantity', parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td>
                        <input
                          className="num-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.price || ''}
                          onChange={e => updateItem(item._tempId, 'price', parseFloat(e.target.value) || 0)}
                          style={{ fontWeight: 600, color: '#cf1322' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 12, fontWeight: 600 }}>
                        {item.amount.toFixed(2)}
                      </td>
                      <td>
                        <input
                          value={item.remark}
                          onChange={e => updateItem(item._tempId, 'remark', e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => removeItem(item._tempId)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600, background: '#fafafa' }}>
                    <td colSpan={5}>合计</td>
                    <td style={{ textAlign: 'right', paddingRight: 12 }}>{totalQuantity.toFixed(2)}</td>
                    <td></td>
                    <td style={{ textAlign: 'right', paddingRight: 12 }}>¥{totalAmount.toFixed(2)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="form-actions">
          <button className="btn" onClick={() => navigate('/')}>
            取消
          </button>
          <button className="btn" onClick={() => navigate('/product-manager')}>
            价格管理
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存订单'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrderEdit
