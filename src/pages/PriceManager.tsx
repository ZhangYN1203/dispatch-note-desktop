import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  searchCustomers, getPriceTables, getPriceTableItems,
  updatePriceTableItem, undoPriceTableChange, getPriceTableLogs,
  createCustomer, updateCustomer, deleteCustomer,
  addPriceTableProduct, removePriceTableProduct,
  searchProducts, createProduct, updateProduct, deleteProduct, createPriceTable, deletePriceTable, renamePriceTable,
  saveFile,
} from '../utils/ipc'
import type { Customer, CustomerPrice, PriceTable, PriceChangeLog, Product } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import * as XLSX from 'xlsx'

const PriceManager: React.FC = () => {
  const navigate = useNavigate()

  // ── Customer & Price Table selection ──
  const [customerCodeSearch, setCustomerCodeSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const [priceTables, setPriceTables] = useState<PriceTable[]>([])
  const [selectedTable, setSelectedTable] = useState<PriceTable | null>(null)

  // ── Prices ──
  const [prices, setPrices] = useState<CustomerPrice[]>([])
  const [filteredPrices, setFilteredPrices] = useState<CustomerPrice[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // ── Price search ──
  const [priceSearch, setPriceSearch] = useState('')

  // ── Edit price ──
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // ── Change logs ──
  const [changeLogs, setChangeLogs] = useState<PriceChangeLog[]>([])
  const [showLogs, setShowLogs] = useState(false)

  // ── Product catalog management ──
  const [showProductCatalog, setShowProductCatalog] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [editProductData, setEditProductData] = useState<Product | null>(null)
  const [savingProduct, setSavingProduct] = useState(false)

  const loadAllProducts = async () => {
    try {
      const data = await searchProducts('')
      setAllProducts(data)
    } catch (_) {}
  }

  const handleEditProduct = (product: Product) => {
    setEditProductData({ ...product })
  }

  const saveEditProduct = async () => {
    if (!editProductData) return
    if (!editProductData.productCode.trim()) {
      setMessage('产品编码不能为空')
      return
    }
    if (!editProductData.productName.trim()) {
      setMessage('产品名称不能为空')
      return
    }
    try {
      setSavingProduct(true)
      const result = await updateProduct(editProductData.id, {
        productCode: editProductData.productCode,
        productName: editProductData.productName,
        specification: editProductData.specification,
        packageSpec: editProductData.packageSpec,
        unit: editProductData.unit,
        price: editProductData.price,
      })
      if (result.success) {
        setMessage('商品信息已更新')
        setEditProductData(null)
        await loadAllProducts()
        if (selectedTable) loadPrices()
      } else {
        setMessage(result.message || '更新失败')
      }
    } catch (err: any) {
      setMessage(`更新失败: ${err.message}`)
    } finally {
      setSavingProduct(false)
    }
  }

  const handleDeleteBaseProduct = async (product: Product) => {
    setDeleteTarget({ type: 'baseProduct', id: product.id, name: product.productName })
  }

  const confirmDeleteBaseProduct = async () => {
    if (!deleteTarget || !deleteTarget.id) return
    try {
      const result = await deleteProduct(deleteTarget.id)
      if (result.success) {
        setMessage(`商品「${deleteTarget.name}」已删除`)
        await loadAllProducts()
        if (selectedTable) loadPrices()
      } else {
        setMessage(result.message || '删除失败')
      }
    } catch (err: any) {
      setMessage(`删除失败: ${err.message}`)
    }
    setDeleteTarget(null)
  }

  // ── Add customer dialog ──
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [editCustomerData, setEditCustomerData] = useState<Partial<Customer>>({})
  const [savingCustomer, setSavingCustomer] = useState(false)

  // ── Add/Edit price table dialog ──
  const [showAddTable, setShowAddTable] = useState(false)
  const [showEditTable, setShowEditTable] = useState(false)
  const [editTableName, setEditTableName] = useState('')
  const [savingTable, setSavingTable] = useState(false)

  // ── Add product dialog ──
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productRef = useRef<HTMLInputElement>(null)

  // ── Add new product to base catalog ──
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProductData, setNewProductData] = useState<{ brand: string; productCode: string; productName: string; specification: string; packageSpec: string; unit: string; price: number }>({
    brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0,
  })
  const [savingNewProduct, setSavingNewProduct] = useState(false)

  // ── Confirm delete ──
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'customer' | 'product' | 'table' | 'baseProduct'; id?: number; code?: string; name: string } | null>(null)

  // ── Load customers and price tables on mount ──
  useEffect(() => {
    searchCustomers('').then(setCustomerResults).catch(() => {})
    loadPriceTables()
  }, [])

  const loadPriceTables = async () => {
    try {
      const tables = await getPriceTables()
      setPriceTables(tables)
    } catch (_) {}
  }

  // ── Filter prices when priceSearch changes ──
  useEffect(() => {
    if (!priceSearch.trim()) {
      setFilteredPrices(prices)
      return
    }
    const s = priceSearch.toLowerCase()
    setFilteredPrices(
      prices.filter(p =>
        (p.productCode && p.productCode.toLowerCase().includes(s)) ||
        (p.productName && p.productName.toLowerCase().includes(s)) ||
        (p.specification && p.specification.toLowerCase().includes(s))
      )
    )
  }, [priceSearch, prices])

  // ── Customer search ──
  const handleCustomerSearch = useCallback(async (keyword: string) => {
    setCustomerCodeSearch(keyword)
    try {
      const results = await searchCustomers(keyword || undefined)
      setCustomerResults(results)
      setShowCustomerDropdown(true)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const selectCustomer = useCallback(async (customer: Customer) => {
    setSelectedCustomer(customer)
    setCustomerCodeSearch(`${customer.code} - ${customer.name}`)
    setShowCustomerDropdown(false)
    setMessage('')
    setShowLogs(false)
    setPriceSearch('')

    // Select the customer's price table
    const table = priceTables.find(t => t.id === customer.priceTableId)
    if (table) {
      setSelectedTable(table)
      loadPrices(table.id)
    } else {
      // Fallback: load price table by ID
      setSelectedTable(null)
      setPrices([])
      setFilteredPrices([])
    }
  }, [priceTables])

  const loadPrices = useCallback(async (tableId?: number) => {
    const id = tableId ?? selectedTable?.id
    if (!id) return
    try {
      setLoading(true)
      const data = await getPriceTableItems(id)
      setPrices(data)
      setFilteredPrices(data)
    } catch (_) {} finally {
      setLoading(false)
    }
  }, [selectedTable])

  // ── Price Table selection ──
  const selectPriceTable = async (table: PriceTable) => {
    setSelectedTable(table)
    setSelectedCustomer(null)
    setCustomerCodeSearch('')
    setPriceSearch('')
    setShowLogs(false)
    setMessage('')
    loadPrices(table.id)
  }

  // ── Add/Edit Price Table ──
  const openAddTable = () => {
    setEditTableName('')
    setShowAddTable(true)
  }

  const openEditTable = () => {
    if (!selectedTable) return
    setEditTableName(selectedTable.name)
    setShowEditTable(true)
  }

  const handleSaveTable = async () => {
    if (!editTableName.trim()) {
      setMessage('价格表名称不能为空')
      return
    }
    try {
      setSavingTable(true)
      if (showAddTable) {
        const result = await createPriceTable(editTableName.trim())
        setMessage(`价格表「${editTableName.trim()}」已创建`)
        await loadPriceTables()
        // Select the new table
        const tables = await getPriceTables()
        const newTable = tables.find(t => t.id === result.id)
        if (newTable) selectPriceTable(newTable)
      } else if (showEditTable && selectedTable) {
        await renamePriceTable(selectedTable.id, editTableName.trim())
        setMessage(`价格表已重命名为「${editTableName.trim()}」`)
        await loadPriceTables()
        setSelectedTable(prev => prev ? { ...prev, name: editTableName.trim() } : null)
      }
      setShowAddTable(false)
      setShowEditTable(false)
    } catch (err: any) {
      setMessage(`操作失败: ${err.message}`)
    } finally {
      setSavingTable(false)
    }
  }

  const handleDeleteTable = async () => {
    if (!deleteTarget || !selectedTable) return
    try {
      const result = await deletePriceTable(selectedTable.id)
      if (result.success) {
        setMessage(`价格表「${selectedTable.name}」已删除`)
        setSelectedTable(null)
        setPrices([])
        setFilteredPrices([])
        await loadPriceTables()
      } else {
        setMessage(result.message || '删除失败')
      }
    } catch (err: any) {
      setMessage(`删除失败: ${err.message}`)
    }
    setDeleteTarget(null)
  }

  // ── Add customer ──
  const openAddCustomer = () => {
    setEditCustomerData({ code: '', name: '', address: '', contact: '', phone: '', remark: '' })
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
        // Assign to the currently selected price table, or default
        const priceTableId = selectedTable?.id || 0
        await createCustomer({ ...editCustomerData as any, priceTableId })
        setMessage(`客户 ${editCustomerData.name} 已添加`)
        searchCustomers('').then(setCustomerResults)
      } else if (showEditCustomer && selectedCustomer) {
        await updateCustomer(selectedCustomer.id, editCustomerData)
        const updated = await searchCustomers(editCustomerData.code || '')
        setMessage(`客户信息已更新`)
        if (updated.length > 0) {
          setSelectedCustomer(updated[0])
          setCustomerCodeSearch(`${updated[0].code} - ${updated[0].name}`)
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
    if (!deleteTarget || !selectedCustomer) return
    try {
      await deleteCustomer(selectedCustomer.id)
      setMessage(`客户 ${selectedCustomer.name} 已删除`)
      setSelectedCustomer(null)
      setCustomerCodeSearch('')
      setPrices([])
      setFilteredPrices([])
      setDeleteTarget(null)
      searchCustomers('').then(setCustomerResults)
    } catch (err: any) {
      setMessage(`删除失败: ${err.message}`)
    }
  }

  // ── Price editing ──
  const handleEdit = (productCode: string, currentPrice: number) => {
    setEditingCode(productCode)
    setEditValue(String(currentPrice))
  }

  const handleSavePrice = async (productCode: string) => {
    const newPrice = parseFloat(editValue)
    if (isNaN(newPrice) || newPrice < 0) {
      setMessage('请输入有效的价格')
      return
    }
    if (!selectedTable) return

    try {
      const result = await updatePriceTableItem(selectedTable.id, productCode, newPrice)
      if (result.success) {
        setMessage(`价格已更新：${productCode} → ¥${newPrice.toFixed(2)}`)
        setEditingCode(null)
        loadPrices()
      }
    } catch (err: any) {
      setMessage(`更新失败: ${err.message}`)
    }
  }

  const handleUndo = async () => {
    if (!selectedTable) return
    try {
      const result = await undoPriceTableChange(selectedTable.id)
      if (result.success && result.log) {
        setMessage(`已撤销：${result.log.productCode} 恢复为 ¥${result.log.oldPrice.toFixed(2)}`)
        loadPrices()
      } else {
        setMessage(result.message || '没有可撤销的修改')
      }
    } catch (err: any) {
      setMessage(`撤销失败: ${err.message}`)
    }
  }

  const handleShowLogs = async () => {
    if (!selectedTable) return
    if (showLogs) {
      setShowLogs(false)
      return
    }
    try {
      const logs = await getPriceTableLogs(selectedTable.id)
      setChangeLogs(logs)
      setShowLogs(true)
    } catch (_) {}
  }

  // ── Export price table to Excel ──
  const exportPriceTable = async () => {
    if (!selectedTable || filteredPrices.length === 0) return
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(filteredPrices.map((p, i) => ({
      '序号': i + 1,
      '产品编码': p.productCode,
      '产品名称': p.productName || '',
      '规格': p.specification || '',
      '整箱规格': p.packageSpec || '',
      '单位': p.unit || '',
      '价格': p.price,
    })))

    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 10 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, '价格明细')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    await saveFile({ defaultName: `${selectedTable.name}.xlsx`, buffer: Array.from(new Uint8Array(buf)) })
  }

  // ── Add product to price table ──
  const handleProductSearch = useCallback(async (keyword: string) => {
    setProductSearch(keyword)
    try {
      const results = await searchProducts(keyword || undefined)
      setProductResults(results)
      setShowProductDropdown(true)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleAddProduct = async (product: Product) => {
    if (!selectedTable) return
    try {
      const result = await addPriceTableProduct(selectedTable.id, product.productCode)
      if (result.success) {
        setMessage(`已添加：${product.productName}`)
        loadPrices()
      } else {
        setMessage(result.message || '添加失败')
      }
    } catch (err: any) {
      setMessage(`添加失败: ${err.message}`)
    }
    setShowAddProduct(false)
    setProductSearch('')
    setProductResults([])
  }

  const handleRemoveProduct = async (productCode: string, productName: string) => {
    if (!selectedTable) return
    setDeleteTarget({ type: 'product', code: productCode, name: productName })
  }

  const confirmRemoveProduct = async () => {
    if (!deleteTarget || !selectedTable || !deleteTarget.code) return
    try {
      const result = await removePriceTableProduct(selectedTable.id, deleteTarget.code)
      if (result.success) {
        setMessage(`已移除：${deleteTarget.name}`)
        loadPrices()
      } else {
        setMessage(result.message || '移除失败')
      }
    } catch (err: any) {
      setMessage(`移除失败: ${err.message}`)
    }
    setDeleteTarget(null)
  }

  // ── Add new product to catalog ──
  const handleSaveNewProduct = async () => {
    // Frontend validation
    if (!newProductData.productCode.trim()) {
      setMessage('产品编码为必填')
      return
    }
    if (!newProductData.productName.trim()) {
      setMessage('产品名称为必填')
      return
    }
    if (!newProductData.specification.trim()) {
      setMessage('规格为必填')
      return
    }
    if (!newProductData.packageSpec.trim()) {
      setMessage('整箱规格为必填')
      return
    }
    if (!newProductData.unit.trim()) {
      setMessage('单位为必填')
      return
    }
    if (newProductData.price <= 0) {
      setMessage('单价必须大于0')
      return
    }

    try {
      setSavingNewProduct(true)
      const result = await createProduct(newProductData)
      if (result.id === -1 || (result as any).error) {
        setMessage((result as any).error || '添加失败')
        return
      }
      setMessage(`新产品「${newProductData.productName}」已添加`)
      setShowNewProduct(false)
      setNewProductData({ brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0 })
      // Reload prices if a table is selected
      if (selectedTable) loadPrices()
    } catch (err: any) {
      setMessage(`添加失败: ${err.message}`)
    } finally {
      setSavingNewProduct(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>客户价格管理</h1>
        <div className="btn-group">
          <button className="btn" onClick={() => navigate(-1)}>
            ← 返回
          </button>
        </div>
      </div>

      {message && (
        <div
          className="error-message"
          style={{
            background: message.includes('失败') || message.includes('没有') ? '#fff2f0' : '#f6ffed',
            borderColor: message.includes('失败') || message.includes('没有') ? '#ffccc7' : '#b7eb8f',
            color: message.includes('失败') || message.includes('没有') ? '#ff4d4f' : '#52c41a',
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
        {/* ── 价格表切换区 ── */}
        <div className="form-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ border: 'none', margin: 0, padding: 0 }}>价格表</h2>
            <div className="btn-group">
              <button className="btn btn-sm" onClick={openAddTable}>+ 新建价格表</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {priceTables.map(t => (
              <div
                key={t.id}
                style={{
                  padding: '10px 16px',
                  background: selectedTable?.id === t.id ? '#e6f4ff' : '#fff',
                  border: selectedTable?.id === t.id ? '2px solid #1677ff' : '1px solid #d9d9d9',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: selectedTable?.id === t.id ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={() => selectPriceTable(t)}
              >
                <span>{t.name}</span>
                {t.isDefault ? <span style={{ fontSize: 11, color: '#888', background: '#f5f5f5', padding: '1px 6px', borderRadius: 4 }}>默认</span> : null}
              </div>
            ))}
            {priceTables.length === 0 && (
              <span style={{ color: '#999' }}>暂无价格表</span>
            )}
          </div>

          {/* 价格表操作按钮 */}
          {selectedTable && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={openEditTable}>重命名</button>
              {!selectedTable.isDefault && (
                <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget({ type: 'table', id: selectedTable.id, name: selectedTable.name })}>
                  删除
                </button>
              )}
              <button className="btn btn-sm" onClick={() => { setShowProductCatalog(!showProductCatalog); if (!showProductCatalog) loadAllProducts() }}>
                {showProductCatalog ? '收起商品管理' : '商品管理'}
              </button>
            </div>
          )}
        </div>

        {/* ── 商品管理 ── */}
        {showProductCatalog && (
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ border: 'none', margin: 0, padding: 0 }}>商品管理</h2>
              <span style={{ fontSize: 12, color: '#888' }}>共 {allProducts.length} 个商品</span>
            </div>
            {allProducts.length === 0 ? (
              <div className="empty-state"><p>暂无商品数据</p></div>
            ) : (
              <div className="items-editor" style={{ maxHeight: 400, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>序号</th>
                      <th>编码</th>
                      <th>名称</th>
                      <th>规格</th>
                      <th style={{ width: 70 }}>整箱规格</th>
                      <th style={{ width: 50 }}>单位</th>
                      <th style={{ width: 80 }}>单价</th>
                      <th style={{ width: 70 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allProducts.map((p, i) => (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td>{p.productCode}</td>
                        <td>{p.productName}</td>
                        <td>{p.specification || '-'}</td>
                        <td>{p.packageSpec || '-'}</td>
                        <td>{p.unit || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>¥{(p.price || 0).toFixed(2)}</td>
                        <td>
                          <div className="btn-group" style={{ gap: 4 }}>
                            <button
                              className="btn btn-sm"
                              onClick={() => handleEditProduct(p)}
                            >
                              编辑
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteBaseProduct(p)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── 客户搜索 ── */}
        <div className="form-section">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <input
              value={customerCodeSearch}
              onChange={e => { setCustomerCodeSearch(e.target.value); handleCustomerSearch(e.target.value) }}
              placeholder="搜索客户编码、名称..."
              style={{ flex: 1, maxWidth: 400, padding: '7px 11px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, outline: 'none' }}
              onFocus={() => {
                if (customerCodeSearch) handleCustomerSearch(customerCodeSearch)
                else { setShowCustomerDropdown(true); handleCustomerSearch('') }
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={openAddCustomer}>
              + 添加客户
            </button>
          </div>

          {!selectedCustomer ? (
            <div>
              {customerResults.length === 0 ? (
                <div className="empty-state"><p>暂无客户，请点击"添加客户"</p></div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                  {customerResults.map(c => (
                    <div
                      key={c.id}
                      style={{
                        padding: '14px 16px', background: '#fff', border: '1px solid #e8e8e8',
                        borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onClick={() => selectCustomer(c)}
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
                border: '1px solid #d6e4ff', borderRadius: 8, display: 'flex',
                justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <strong style={{ fontSize: 15 }}>{selectedCustomer.name}</strong>
                  <span style={{ marginLeft: 12, color: '#888', fontSize: 13 }}>
                    [{selectedCustomer.code}]
                  </span>
                  <div style={{ marginTop: 4, fontSize: 13, color: '#666' }}>
                    {selectedCustomer.address}{selectedCustomer.contact ? ` | 联系人: ${selectedCustomer.contact}` : ''}{selectedCustomer.phone ? ` | ${selectedCustomer.phone}` : ''}
                    {selectedCustomer.remark ? <span style={{ marginLeft: 8, color: '#999' }}>备注: {selectedCustomer.remark}</span> : ''}
                    {selectedCustomer.priceTableName ? <span style={{ marginLeft: 8, color: '#1677ff' }}>价格表: {selectedCustomer.priceTableName}</span> : ''}
                  </div>
                </div>
                <div className="btn-group">
                  <button className="btn btn-sm" onClick={() => {
                    setSelectedCustomer(null)
                    setCustomerCodeSearch('')
                    setPrices([])
                    setFilteredPrices([])
                    searchCustomers('').then(setCustomerResults)
                  }}>
                    ← 返回
                  </button>
                  <button className="btn btn-sm" onClick={openEditCustomer}>编辑</button>
                  <button className="btn btn-sm btn-danger" onClick={() => {
                    if (selectedCustomer) setDeleteTarget({ type: 'customer', name: selectedCustomer.name })
                  }}>删除</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {selectedTable && (
          <>
            {/* ── Price Table Items ── */}
            <div className="form-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ border: 'none', margin: 0, padding: 0 }}>
                  {selectedTable.name} - 价格明细
                </h2>
                <div className="btn-group">
                  <button className="btn btn-sm" onClick={handleShowLogs}>
                    {showLogs ? '隐藏记录' : '修改记录'}
                  </button>
                  <button className="btn btn-sm" onClick={handleUndo}>
                    撤销上次修改
                  </button>
                  {filteredPrices.length > 0 && (
                    <button className="btn btn-sm" onClick={exportPriceTable}>
                      导出 Excel
                    </button>
                  )}
                </div>
              </div>

              <div className="form-field" style={{ marginBottom: 12, maxWidth: 400 }}>
                <input
                  value={priceSearch}
                  onChange={e => setPriceSearch(e.target.value)}
                  placeholder="搜索产品编码、名称、规格..."
                />
              </div>

              {loading ? (
                <div className="loading">加载中...</div>
              ) : filteredPrices.length === 0 ? (
                <div className="empty-state">
                  <p>{priceSearch ? '未找到匹配产品' : '该价格表暂无数据'}</p>
                </div>
              ) : (
                <div className="items-editor">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 50 }}>序号</th>
                        <th>产品编码</th>
                        <th>产品名称</th>
                        <th>规格</th>
                        <th style={{ width: 70 }}>整箱规格</th>
                        <th style={{ width: 50 }}>单位</th>
                        <th style={{ width: 100 }}>价格</th>
                        <th style={{ width: 130 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPrices.map((p, i) => (
                        <tr key={p.productCode}>
                          <td>{i + 1}</td>
                          <td>{p.productCode}</td>
                          <td>{p.productName || '-'}</td>
                          <td>{p.specification || '-'}</td>
                          <td>{p.packageSpec || '-'}</td>
                          <td>{p.unit || '-'}</td>
                          <td>
                            {editingCode === p.productCode ? (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSavePrice(p.productCode)
                                    if (e.key === 'Escape') setEditingCode(null)
                                  }}
                                  style={{ width: 100, textAlign: 'right' }}
                                  autoFocus
                                />
                                <button className="btn btn-sm btn-primary" onClick={() => handleSavePrice(p.productCode)}>保存</button>
                                <button className="btn btn-sm" onClick={() => setEditingCode(null)}>取消</button>
                              </div>
                            ) : (
                              <span style={{ fontWeight: 500 }}>¥{p.price.toFixed(2)}</span>
                            )}
                          </td>
                          <td>
                            <div className="btn-group">
                              {editingCode !== p.productCode && (
                                <>
                                  <button className="btn btn-sm" onClick={() => handleEdit(p.productCode, p.price)}>
                                    修改
                                  </button>
                                  {!selectedTable.isDefault && (
                                    <button className="btn btn-sm btn-danger" onClick={() => handleRemoveProduct(p.productCode, p.productName || p.productCode)}>
                                      删除
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add product / New product buttons */}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => { setShowAddProduct(true); setTimeout(() => handleProductSearch(''), 50) }}
                >
                  + 从价目表添加产品
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => { setShowNewProduct(true); setNewProductData({ brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0 }) }}
                >
                  + 添加新商品
                </button>
              </div>

              {/* Add product dropdown */}
              {showAddProduct && (
                <div style={{ position: 'relative', marginTop: 8, maxWidth: 500 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      ref={productRef}
                      value={productSearch}
                      onChange={e => handleProductSearch(e.target.value)}
                      onFocus={() => handleProductSearch(productSearch)}
                      placeholder="搜索产品..."
                      style={{ flex: 1, padding: '7px 11px', border: '2px solid #1677ff', borderRadius: 6, fontSize: 14 }}
                      autoFocus
                    />
                    <button className="btn btn-sm" onClick={() => { setShowAddProduct(false); setProductSearch('') }}>
                      取消
                    </button>
                  </div>
                  {showProductDropdown && productResults.length > 0 && (
                    <div className="dropdown-menu" style={{ width: '100%', maxHeight: 250 }}>
                      {productResults.map(p => (
                        <div
                          key={p.id}
                          className="dropdown-item"
                          onMouseDown={() => handleAddProduct(p)}
                        >
                          <div className="dropdown-item-primary">[{p.productCode}] {p.productName}</div>
                          <div className="dropdown-item-secondary">
                            {p.specification} / {p.unit} / ¥{p.price.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showProductDropdown && productResults.length === 0 && productSearch && (
                    <div className="dropdown-menu" style={{ width: '100%' }}>
                      <div className="dropdown-item" style={{ color: '#999' }}>未找到匹配产品</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Change Logs ── */}
            {showLogs && (
              <div className="form-section">
                <h2>修改记录</h2>
                {changeLogs.length === 0 ? (
                  <div className="empty-state"><p>暂无修改记录</p></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>产品编码</th>
                        <th>原价</th>
                        <th>新价</th>
                        <th>修改时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changeLogs.map(log => (
                        <tr key={log.id}>
                          <td>{log.productCode}</td>
                          <td style={{ color: '#ff4d4f' }}>¥{log.oldPrice.toFixed(2)}</td>
                          <td style={{ color: '#52c41a' }}>¥{log.newPrice.toFixed(2)}</td>
                          <td>{log.changedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
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
                  value={editCustomerData.priceTableId || (selectedTable?.id || '')}
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
              <button className="btn" onClick={() => { setShowAddCustomer(false); setShowEditCustomer(false) }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSaveCustomer} disabled={savingCustomer}>
                {savingCustomer ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Price Table Dialog ── */}
      {(showAddTable || showEditTable) && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 400 }}>
            <h3>{showAddTable ? '新建价格表' : '重命名价格表'}</h3>
            <div style={{ marginTop: 16 }}>
              <div className="form-field">
                <label>价格表名称</label>
                <input
                  value={editTableName}
                  onChange={e => setEditTableName(e.target.value)}
                  placeholder="如: 2024年价格表"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveTable() }}
                />
              </div>
            </div>
            <div className="btn-group" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setShowAddTable(false); setShowEditTable(false) }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSaveTable} disabled={savingTable}>
                {savingTable ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add New Product Dialog ── */}
      {showNewProduct && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 520 }}>
            <h3>添加新商品到价目表</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div className="form-field">
                <label>品牌</label>
                <input value={newProductData.brand} onChange={e => setNewProductData(p => ({ ...p, brand: e.target.value }))} placeholder="如: 演示品牌" />
              </div>
              <div className="form-field">
                <label>产品编码 *</label>
                <input value={newProductData.productCode} onChange={e => setNewProductData(p => ({ ...p, productCode: e.target.value }))} placeholder="如: 90030" />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>产品名称 *</label>
                <input value={newProductData.productName} onChange={e => setNewProductData(p => ({ ...p, productName: e.target.value }))} placeholder="如: 油辣椒" />
              </div>
              <div className="form-field">
                <label>规格</label>
                <input value={newProductData.specification} onChange={e => setNewProductData(p => ({ ...p, specification: e.target.value }))} placeholder="如: 200g" />
              </div>
              <div className="form-field">
                <label>整箱规格</label>
                <input value={newProductData.packageSpec} onChange={e => setNewProductData(p => ({ ...p, packageSpec: e.target.value }))} placeholder="如: 1x20" />
              </div>
              <div className="form-field">
                <label>单位</label>
                <input value={newProductData.unit} onChange={e => setNewProductData(p => ({ ...p, unit: e.target.value }))} placeholder="件" />
              </div>
              <div className="form-field">
                <label>单价（元）</label>
                <input type="number" step="0.01" min="0" value={newProductData.price || ''} onChange={e => setNewProductData(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
            </div>
            <div className="btn-group" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setShowNewProduct(false) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveNewProduct} disabled={savingNewProduct}>
                {savingNewProduct ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Product Dialog ── */}
      {editProductData && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 520 }}>
            <h3>编辑商品</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div className="form-field">
                <label>品牌</label>
                <input value={editProductData.brand || ''} onChange={e => setEditProductData(p => p ? { ...p, brand: e.target.value } : null)} placeholder="如: 演示品牌" />
              </div>
              <div className="form-field">
                <label>产品编码 *</label>
                <input value={editProductData.productCode} onChange={e => setEditProductData(p => p ? { ...p, productCode: e.target.value } : null)} placeholder="如: 90030" />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>产品名称 *</label>
                <input value={editProductData.productName} onChange={e => setEditProductData(p => p ? { ...p, productName: e.target.value } : null)} placeholder="如: 油辣椒" />
              </div>
              <div className="form-field">
                <label>规格</label>
                <input value={editProductData.specification || ''} onChange={e => setEditProductData(p => p ? { ...p, specification: e.target.value } : null)} placeholder="如: 200g" />
              </div>
              <div className="form-field">
                <label>整箱规格</label>
                <input value={editProductData.packageSpec || ''} onChange={e => setEditProductData(p => p ? { ...p, packageSpec: e.target.value } : null)} placeholder="如: 1x20" />
              </div>
              <div className="form-field">
                <label>单位</label>
                <input value={editProductData.unit || ''} onChange={e => setEditProductData(p => p ? { ...p, unit: e.target.value } : null)} placeholder="件" />
              </div>
              <div className="form-field">
                <label>单价（元）</label>
                <input type="number" step="0.01" min="0" value={editProductData.price || ''} onChange={e => setEditProductData(p => p ? { ...p, price: parseFloat(e.target.value) || 0 } : null)} placeholder="0.00" />
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              提示：如修改产品编码，所有价格表将自动同步更新引用。
            </div>
            <div className="btn-group" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditProductData(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveEditProduct} disabled={savingProduct}>
                {savingProduct ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete ── */}
      {deleteTarget && (
        <ConfirmDialog
          title={
            deleteTarget.type === 'customer' ? '确认删除客户' :
            deleteTarget.type === 'table' ? '确认删除价格表' :
            deleteTarget.type === 'baseProduct' ? '确认删除商品' :
            '确认移除产品'
          }
          message={
            deleteTarget.type === 'customer'
              ? `确定要删除客户「${deleteTarget.name}」吗？`
              : deleteTarget.type === 'table'
              ? `确定要删除价格表「${deleteTarget.name}」吗？使用该价格表的客户将自动关联到默认价格表。`
              : deleteTarget.type === 'baseProduct'
              ? `确定要删除商品「${deleteTarget.name}」吗？此操作会同时从所有价格表中移除该商品，不可恢复。`
              : `确定要从价格表中移除「${deleteTarget.name}」吗？`
          }
          onConfirm={
            deleteTarget.type === 'customer' ? handleDeleteCustomer :
            deleteTarget.type === 'table' ? handleDeleteTable :
            deleteTarget.type === 'baseProduct' ? confirmDeleteBaseProduct :
            confirmRemoveProduct
          }
          onCancel={() => setDeleteTarget(null)}
          confirmText="确认"
          danger
        />
      )}
    </div>
  )
}

export default PriceManager
