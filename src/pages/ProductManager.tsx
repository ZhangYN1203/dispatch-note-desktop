import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getPriceTables, getPriceTableItems,
  updatePriceTableItem, undoPriceTableChange, getPriceTableLogs,
  addPriceTableProduct, removePriceTableProduct,
  searchProducts, createProduct, deleteProduct, updateProduct,
  createPriceTable, deletePriceTable, renamePriceTable,
  getCustomersByPriceTableId,
} from '../utils/ipc'
import type { Customer, CustomerPrice, PriceTable, PriceChangeLog, Product } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

const ProductManager: React.FC = () => {
  const navigate = useNavigate()

  const [priceTables, setPriceTables] = useState<PriceTable[]>([])
  const [selectedTable, setSelectedTable] = useState<PriceTable | null>(null)
  const [defaultTable, setDefaultTable] = useState<PriceTable | null>(null)

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

  // ── Edit product info (only on default table) ──
  const [editProductData, setEditProductData] = useState<Product | null>(null)
  const [savingProduct, setSavingProduct] = useState(false)

  // ── Add/Edit price table dialog ──
  const [showAddTable, setShowAddTable] = useState(false)
  const [showEditTable, setShowEditTable] = useState(false)
  const [editTableName, setEditTableName] = useState('')
  const [savingTable, setSavingTable] = useState(false)

  // ── Add product from catalog dialog ──
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productRef = useRef<HTMLInputElement>(null)

  // ── Add new product ──
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProductData, setNewProductData] = useState<{ brand: string; productCode: string; productName: string; specification: string; packageSpec: string; unit: string; price: number }>({
    brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0,
  })
  const [savingNewProduct, setSavingNewProduct] = useState(false)

  // ── Confirm delete ──
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'product' | 'table'; id?: number; code?: string; name: string } | null>(null)
  const [deleteAffectedCustomers, setDeleteAffectedCustomers] = useState<Customer[] | null>(null)

  // ── Load price tables on mount ──
  useEffect(() => {
    loadPriceTables()
  }, [])

  const loadPriceTables = async () => {
    try {
      const tables = await getPriceTables()
      setPriceTables(tables)
      const def = tables.find(t => t.isDefault)
      setDefaultTable(def || null)
    } catch (_) {}
  }

  const isDefaultTable = Boolean(selectedTable?.isDefault)

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
    setPriceSearch('')
    setShowLogs(false)
    setMessage('')
    setEditingCode(null)
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

  // ── Delete price table with affected customers check ──
  const handleDeleteTableClick = async () => {
    if (!selectedTable || selectedTable.isDefault) return
    try {
      const customers = await getCustomersByPriceTableId(selectedTable.id)
      setDeleteAffectedCustomers(customers)
      setDeleteTarget({ type: 'table', id: selectedTable.id, name: selectedTable.name })
    } catch (_) {}
  }

  const handleDeleteTableConfirm = async () => {
    if (!deleteTarget || !selectedTable) return
    try {
      const result = await deletePriceTable(selectedTable.id)
      if (result.success) {
        const msg = deleteAffectedCustomers && deleteAffectedCustomers.length > 0
          ? `价格表「${selectedTable.name}」已删除。以下客户已切换到默认价格表：${deleteAffectedCustomers.map(c => c.name).join('、')}`
          : `价格表「${selectedTable.name}」已删除`
        setMessage(msg)
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
    setDeleteAffectedCustomers(null)
  }

  // ── Price editing ──
  const handleEditPrice = (productCode: string, currentPrice: number) => {
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

  // ── Edit product basic info (only on default table) ──
  const handleEditProductInfo = (p: CustomerPrice) => {
    if (!isDefaultTable) return
    // Find the product by productCode to get its actual id
    searchProducts(p.productCode).then(products => {
      const prod = products.find(pr => pr.productCode === p.productCode)
      if (prod) {
        setEditProductData({ ...prod })
      } else {
        setMessage('未找到该商品信息')
      }
    }).catch(() => setMessage('加载商品信息失败'))
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
        setMessage('商品信息已更新，所有价格表引用已同步')
        setEditProductData(null)
        loadPrices()
      } else {
        setMessage(result.message || '更新失败')
      }
    } catch (err: any) {
      setMessage(`更新失败: ${err.message}`)
    } finally {
      setSavingProduct(false)
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

  // ── Add product to price table ──
  const handleProductSearch = useCallback(async (keyword: string) => {
    setProductSearch(keyword)
    try {
      let results = await searchProducts(keyword || undefined)
      // Filter out products already in the current table
      if (selectedTable && results.length > 0) {
        const existingCodes = new Set(prices.map(p => p.productCode))
        results = results.filter(p => !existingCodes.has(p.productCode))
      }
      setProductResults(results)
      setShowProductDropdown(true)
    } catch (err) {
      console.error(err)
    }
  }, [selectedTable, prices])

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

  // ── Add new product (adds to catalog AND syncs to all price tables) ──
  const handleSaveNewProduct = async () => {
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

    try {
      setSavingNewProduct(true)
      const result = await createProduct(newProductData)
      if (result.id === -1 || (result as any).error) {
        setMessage((result as any).error || '添加失败')
        return
      }
      setMessage(`新产品「${newProductData.productName}」已添加，已同步到默认价格表`)
      setShowNewProduct(false)
      setNewProductData({ brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0 })
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
        <h1>商品管理</h1>
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
              {!isDefaultTable && (
                <button className="btn btn-sm btn-danger" onClick={handleDeleteTableClick}>删除</button>
              )}
              <button className="btn btn-sm" onClick={handleShowLogs}>
                {showLogs ? '隐藏记录' : '修改记录'}
              </button>
              <button className="btn btn-sm" onClick={handleUndo}>撤销上次修改</button>
            </div>
          )}
        </div>

        {selectedTable && (
          <>
            {/* ── Price Table Items ── */}
            <div className="form-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ border: 'none', margin: 0, padding: 0 }}>
                  {selectedTable.name} - 商品列表
                </h2>
                {isDefaultTable && (
                  <span style={{ fontSize: 12, color: '#1677ff' }}>
                    默认价格表为商品基础信息库，在此修改编码/名称会同步到所有价格表
                  </span>
                )}
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
                        <th style={{ width: 40 }}>序号</th>
                        <th>产品编码</th>
                        <th>产品名称</th>
                        <th>规格</th>
                        <th style={{ width: 70 }}>整箱规格</th>
                        <th style={{ width: 50 }}>单位</th>
                        <th style={{ width: 100 }}>价格</th>
                        <th style={{ width: 150 }}>操作</th>
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
                            <div className="btn-group" style={{ gap: 4 }}>
                              {editingCode !== p.productCode && (
                                <>
                                  {isDefaultTable ? (
                                    <button className="btn btn-sm" onClick={() => handleEditProductInfo(p)}>编辑</button>
                                  ) : (
                                    <button className="btn btn-sm" onClick={() => handleEditPrice(p.productCode, p.price)}>修改价格</button>
                                  )}
                                  {!isDefaultTable && (
                                    <button className="btn btn-sm btn-danger" onClick={() => handleRemoveProduct(p.productCode, p.productName || p.productCode)}>删除</button>
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

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {selectedTable && !isDefaultTable && (
                  <button className="btn btn-sm btn-primary" onClick={() => { setShowAddProduct(true); setTimeout(() => handleProductSearch(''), 50) }}>
                    + 从默认价格表添加产品
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => { setShowNewProduct(true); setNewProductData({ brand: '', productCode: '', productName: '', specification: '', packageSpec: '', unit: '件', price: 0 }) }}>
                  + 添加新商品
                </button>
              </div>

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
                    <button className="btn btn-sm" onClick={() => { setShowAddProduct(false); setProductSearch('') }}>取消</button>
                  </div>
                  {showProductDropdown && productResults.length > 0 && (
                    <div className="dropdown-menu" style={{ width: '100%', maxHeight: 250 }}>
                      {productResults.map(p => (
                        <div key={p.id} className="dropdown-item" onMouseDown={() => handleAddProduct(p)}>
                          <div className="dropdown-item-primary">[{p.productCode}] {p.productName}</div>
                          <div className="dropdown-item-secondary">{p.specification} / {p.packageSpec} / {p.unit}</div>
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
              <button className="btn" onClick={() => { setShowAddTable(false); setShowEditTable(false) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveTable} disabled={savingTable}>
                {savingTable ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete price table dialog with affected customers ── */}
      {deleteTarget?.type === 'table' && deleteAffectedCustomers !== null && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 500 }}>
            <h3>确认删除价格表</h3>
            <p>确定要删除价格表「{deleteTarget.name}」吗？</p>
            {deleteAffectedCustomers.length > 0 ? (
              <div style={{ margin: '12px 0', padding: 12, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: '#d46b08' }}>
                  以下客户将自动切换到默认价格表：
                </div>
                {deleteAffectedCustomers.map(c => (
                  <div key={c.id} style={{ padding: '3px 0', fontSize: 13 }}>
                    [{c.code}] {c.name}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setDeleteTarget(null); setDeleteAffectedCustomers(null) }}>取消</button>
              <button className="btn btn-danger" onClick={handleDeleteTableConfirm}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Product Info Dialog (only on default table) ── */}
      {editProductData && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 520 }}>
            <h3>编辑商品信息</h3>
            <div style={{ fontSize: 12, color: '#d46b08', marginBottom: 8, background: '#fff7e6', padding: '8px 12px', borderRadius: 6 }}>
              修改编码、名称等信息将自动同步到所有价格表和已有订单
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
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

      {/* ── Add New Product Dialog ── */}
      {showNewProduct && (
        <div className="confirm-overlay">
          <div className="confirm-dialog" style={{ minWidth: 520 }}>
            <h3>添加新商品</h3>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              新商品将自动添加到默认价格表和所有自定义价格表
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
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

      {/* ── Confirm Delete (product removal from price table) ── */}
      {deleteTarget && deleteTarget.type !== 'table' && (
        <ConfirmDialog
          title="确认移除产品"
          message={`确定要从价格表中移除「${deleteTarget.name}」吗？`}
          onConfirm={confirmRemoveProduct}
          onCancel={() => setDeleteTarget(null)}
          confirmText="确认"
          danger
        />
      )}
    </div>
  )
}

export default ProductManager
