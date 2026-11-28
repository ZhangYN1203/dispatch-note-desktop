import { assertDraftOrder } from './order-workflow'
import { queryAll, queryOne, run, withTransaction } from './database'

// ── Auto-generate document number ──
// Format: DB-YYYYMMDD-NNN (e.g. DB-20260627-001)
export function generateDocumentNo(date?: string): string {
  const today = date
    ? date.replace(/-/g, '')
    : new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // Find the max serial for today
  const prefix = `DB-${today}-`
  const rows = queryAll('SELECT documentNo FROM orders WHERE documentNo LIKE ?', [`${prefix}%`])
  const last = { documentNo: `${prefix}${Math.max(0, ...rows.map(row => Number(String(row.documentNo).slice(prefix.length)) || 0))}` }

  let nextSeq = 1
  if (last && last.documentNo) {
    const parts = last.documentNo.split('-')
    const lastSeq = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

export interface OrderData {
  documentNo?: string
  orderNo?: string
  date?: string
  sender?: string
  senderPhone?: string
  receiver?: string
  receiverContact?: string
  receiverPhone?: string
  receiverAddress?: string
  carrierVehicle?: string
  carrierName?: string
  warehouse?: string
  outTime?: string
  tonnage?: string
  mileage?: string
  maker?: string
  reviewer?: string
  remark?: string
}

export interface OrderItemData {
  orderId: number
  productCode?: string
  productName?: string
  specification?: string
  packageSpec?: string
  unit?: string
  quantity?: number
  price?: number
  amount?: number
  remark?: string
  sortOrder?: number
}

function validatedItemNumbers(data: Partial<OrderItemData>) {
  const quantity = data.quantity ?? 0, price = data.price ?? 0
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) throw new Error('明细数量须大于零，单价须为非负数')
  const amount = Math.round((quantity * price + Number.EPSILON) * 100) / 100
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error('明细金额超出范围')
  return { quantity, price, amount }
}

// ── Orders ──

export function getOrders(filters?: { search?: string }) {
  let sql = 'SELECT * FROM orders'
  const params: any[] = []

  if (filters?.search) {
    const s = `%${filters.search}%`
    sql += ' WHERE orderNo LIKE ? OR documentNo LIKE ? OR sender LIKE ? OR receiver LIKE ?'
    params.push(s, s, s, s)
  }

  sql += ' ORDER BY createdAt DESC'

  const rows = queryAll(sql, params)

  // Get item count and total quantity for each order
  return rows.map((row: any) => {
    const countResult = queryOne('SELECT COUNT(*) as count FROM order_items WHERE orderId = ?', [row.id])
    const qtyResult = queryOne('SELECT COALESCE(SUM(quantity), 0) as total FROM order_items WHERE orderId = ?', [row.id])
    return {
      ...row,
      itemCount: countResult?.count || 0,
      totalQuantity: qtyResult?.total || 0,
    }
  })
}

export function getOrderById(id: number) {
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [id])
  if (!order) return null

  const items = queryAll(
    `SELECT * FROM order_items WHERE orderId = ? ORDER BY sortOrder ASC`,
    [id]
  )
  return { ...order, items }
}

export function createOrder(data: OrderData) {
  const d = normalizeOrderData(data)
  if (!d.documentNo || queryOne('SELECT id FROM orders WHERE documentNo=?', [d.documentNo])) d.documentNo = generateDocumentNo(d.date || undefined)
  const result = run(
    `INSERT INTO orders (documentNo, orderNo, date, sender, senderPhone,
      receiver, receiverContact, receiverPhone, receiverAddress, carrierVehicle,
      carrierName, warehouse, outTime, tonnage, mileage, maker, reviewer, remark, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [d.documentNo, d.orderNo, d.date, d.sender, d.senderPhone,
     d.receiver, d.receiverContact, d.receiverPhone, d.receiverAddress, d.carrierVehicle,
     d.carrierName, d.warehouse, d.outTime, d.tonnage, d.mileage, d.maker, d.reviewer, d.remark]
  )
  return { id: result.lastInsertRowid }
}

export function updateOrder(id: number, data: OrderData) {
  assertDraftOrder(id)
  const d = normalizeOrderData(data)
  run(
    `UPDATE orders SET documentNo=?, orderNo=?, date=?, sender=?, senderPhone=?,
      receiver=?, receiverContact=?, receiverPhone=?, receiverAddress=?, carrierVehicle=?,
      carrierName=?, warehouse=?, outTime=?, tonnage=?, mileage=?, maker=?, reviewer=?,
      remark=?, updatedAt=datetime('now','localtime')
    WHERE id=?`,
    [d.documentNo, d.orderNo, d.date, d.sender, d.senderPhone,
     d.receiver, d.receiverContact, d.receiverPhone, d.receiverAddress, d.carrierVehicle,
     d.carrierName, d.warehouse, d.outTime, d.tonnage, d.mileage, d.maker, d.reviewer,
     d.remark, id]
  )
  return { success: true }
}

export function deleteOrder(id: number) {
  assertDraftOrder(id)
  withTransaction(() => {
    run('DELETE FROM order_items WHERE orderId = ?', [id])
    run('DELETE FROM orders WHERE id = ?', [id])
  })
  return { success: true }
}

export function saveOrderWithItems(data: OrderData, items: OrderItemData[], id?: number) {
  if (!Array.isArray(items)) throw new Error('订单明细格式错误')
  const normalized = items.map((item, index) => {
    if (!item.productName?.trim()) throw new Error(`第 ${index + 1} 行商品名称不能为空`)
    const quantity = item.quantity ?? 0
    const price = item.price ?? 0
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
      throw new Error(`第 ${index + 1} 行数量必须大于零，价格不能为负数`)
    }
    const amount = Math.round((quantity * price + Number.EPSILON) * 100) / 100
    if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error('金额超出范围')
    return { ...item, quantity, price, amount, sortOrder: index }
  })
  return withTransaction(() => {
    if (id !== undefined && (!Number.isSafeInteger(id) || !getOrderById(id))) throw new Error('订单不存在')
    const orderId = id ?? createOrder(data).id
    if (id !== undefined) updateOrder(id, data)
    run('DELETE FROM order_items WHERE orderId = ?', [orderId])
    for (const item of normalized) createOrderItem({ ...item, orderId })
    return { id: orderId }
  })
}

function normalizeOrderData(data: OrderData) {
  return {
    documentNo: data.documentNo || '',
    orderNo: data.orderNo || '',
    date: data.date || '',
    sender: data.sender || '',
    senderPhone: data.senderPhone || '',
    receiver: data.receiver || '',
    receiverContact: data.receiverContact || '',
    receiverPhone: data.receiverPhone || '',
    receiverAddress: data.receiverAddress || '',
    carrierVehicle: data.carrierVehicle || '',
    carrierName: data.carrierName || '',
    warehouse: data.warehouse || '',
    outTime: data.outTime || '',
    tonnage: data.tonnage || '',
    mileage: data.mileage || '',
    maker: data.maker || '',
    reviewer: data.reviewer || '',
    remark: data.remark || '',
  }
}

// ── Order Items ──

export function getOrderItems(orderId: number) {
  return queryAll('SELECT * FROM order_items WHERE orderId = ? ORDER BY sortOrder ASC', [orderId])
}

export function createOrderItem(data: OrderItemData) {
  assertDraftOrder(data.orderId)
  data = { ...data, ...validatedItemNumbers(data) }
  const result = run(
    `INSERT INTO order_items (orderId, productCode, productName, specification, unit, quantity, price, amount, remark, sortOrder, packageSpec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.orderId,
      data.productCode || '',
      data.productName || '',
      data.specification || '',
      data.unit || '',
      data.quantity || 0,
      data.price || 0,
      data.amount || 0,
      data.remark || '',
      data.sortOrder || 0,
      data.packageSpec ?? queryOne('SELECT packageSpec FROM products WHERE productCode=?', [data.productCode || ''])?.packageSpec ?? '',
    ]
  )
  return { id: result.lastInsertRowid }
}

export function updateOrderItem(id: number, data: Partial<OrderItemData>) {
  const item = queryOne('SELECT * FROM order_items WHERE id=?', [id])
  if (!item) throw new Error('明细不存在')
  assertDraftOrder(item.orderId)
  data = { ...item, ...data, ...validatedItemNumbers({ ...item, ...data }) }
  run(
    `UPDATE order_items SET productCode=?, productName=?, specification=?, unit=?,
      quantity=?, price=?, amount=?, remark=?, sortOrder=?, packageSpec=?
     WHERE id=?`,
    [
      data.productCode || '',
      data.productName || '',
      data.specification || '',
      data.unit || '',
      data.quantity || 0,
      data.price || 0,
      data.amount || 0,
      data.remark || '',
      data.sortOrder || 0,
      data.packageSpec ?? queryOne('SELECT packageSpec FROM order_items WHERE id=?', [id])?.packageSpec ?? '',
      id,
    ]
  )
  return { success: true }
}

// ── Products & Customers ──

export function searchProducts(keyword?: string) {
  if (keyword) {
    const s = `%${keyword}%`
    return queryAll(
      'SELECT * FROM products WHERE productCode LIKE ? OR productName LIKE ? OR brand LIKE ? ORDER BY productCode ASC',
      [s, s, s]
    )
  }
  return queryAll('SELECT * FROM products ORDER BY productCode ASC')
}

export function deleteProduct(id: number) {
  const product = queryOne('SELECT productCode FROM products WHERE id = ?', [id])
  if (!product) return { success: false, message: '产品不存在' }
  // Remove from all price tables
  run('DELETE FROM price_table_items WHERE productCode = ?', [product.productCode])
  run('DELETE FROM products WHERE id = ?', [id])
  return { success: true }
}

export function updateProduct(id: number, data: { brand?: string; productCode?: string; productName?: string; specification?: string; packageSpec?: string; unit?: string; price?: number }) {
  const current = queryOne('SELECT * FROM products WHERE id = ?', [id])
  if (!current) return { success: false, message: '产品不存在' }

  const newCode = (data.productCode || current.productCode).trim()
  const newName = (data.productName || current.productName).trim()

  // If productCode changed, check for duplicates
  if (newCode !== current.productCode) {
    const dup = queryOne('SELECT id FROM products WHERE productCode = ? AND id != ?', [newCode, id])
    if (dup) return { success: false, message: `产品编码「${newCode}」已存在` }
  }

  // If both productName and specification match an existing record, prevent duplicate
  const newSpec = (data.specification ?? current.specification).trim()
  const dupNameSpec = queryOne(
    'SELECT id FROM products WHERE productName = ? AND specification = ? AND id != ?',
    [newName, newSpec, id]
  )
  if (dupNameSpec) {
    return { success: false, message: `产品名称「${newName}」与规格「${newSpec}」已存在` }
  }

  const oldCode = current.productCode
  return withTransaction(() => {
  run(
    `UPDATE products SET productCode=?, productName=?, specification=?, packageSpec=?, unit=?, price=?, brand=? WHERE id=?`,
    [
      newCode,
      newName,
      data.specification ?? current.specification,
      data.packageSpec ?? current.packageSpec,
      data.unit ?? current.unit,
      data.price ?? current.price,
      data.brand ?? current.brand,
      id,
    ]
  )

  // If productCode changed, update all price tables to keep reference intact
  if (newCode !== oldCode) {
    run('UPDATE price_table_items SET productCode = ? WHERE productCode = ?', [newCode, oldCode])
    run('UPDATE price_change_log SET productCode = ? WHERE productCode = ?', [newCode, oldCode])
  }

  return { success: true }
  })
}

export function createProduct(data: { brand?: string; productCode: string; productName: string; specification?: string; packageSpec?: string; unit?: string; price?: number }) {
  const initialPrice = data.price ?? 0
  if (!Number.isFinite(initialPrice) || initialPrice < 0 || initialPrice > Number.MAX_SAFE_INTEGER / 100) return { id: -1, error: '请输入有效的非负单价' }
  // Validate required fields
  if (!data.productCode || !data.productCode.trim()) {
    return { id: -1, error: '产品编码不能为空' }
  }
  if (!data.productName || !data.productName.trim()) {
    return { id: -1, error: '产品名称不能为空' }
  }
  if (!data.unit || !data.unit.trim()) {
    return { id: -1, error: '单位不能为空' }
  }

  // Check duplicate productCode
  const existingByCode = queryOne('SELECT id FROM products WHERE productCode = ?', [data.productCode.trim()])
  if (existingByCode) {
    return { id: -1, error: `产品编码「${data.productCode.trim()}」已存在` }
  }

  // Check duplicate productName + specification combination
  const existingByNameSpec = queryOne(
    'SELECT id FROM products WHERE productName = ? AND specification = ?',
    [data.productName.trim(), data.specification?.trim() || '']
  )
  if (existingByNameSpec) {
    return { id: -1, error: `产品名称「${data.productName.trim()}」与规格「${data.specification?.trim() || ''}」组合已存在` }
  }

  return withTransaction(() => {
  const result = run(
    'INSERT INTO products (brand, productCode, productName, specification, packageSpec, unit, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.brand || '', data.productCode.trim(), data.productName.trim(), data.specification || '', data.packageSpec || '', data.unit!.trim(), initialPrice]
  )

  // Also sync to all price tables
  const tables = queryAll('SELECT id FROM price_tables')
  for (const t of tables) {
    run(
      'INSERT OR IGNORE INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
      [t.id, data.productCode.trim(), initialPrice]
    )
  }

  return { id: result.lastInsertRowid }
  })
}

export function searchCustomers(keyword?: string) {
  if (keyword) {
    const s = `%${keyword}%`
    return queryAll(
      'SELECT c.*, pt.name as priceTableName FROM customers c LEFT JOIN price_tables pt ON c.priceTableId = pt.id WHERE c.code LIKE ? OR c.name LIKE ? OR c.address LIKE ? OR c.contact LIKE ? OR c.phone LIKE ? OR c.remark LIKE ? ORDER BY c.code ASC',
      [s, s, s, s, s, s]
    )
  }
  return queryAll('SELECT c.*, pt.name as priceTableName FROM customers c LEFT JOIN price_tables pt ON c.priceTableId = pt.id ORDER BY c.code ASC')
}

export function getCustomerByCode(code: string) {
  return queryOne('SELECT c.*, pt.name as priceTableName FROM customers c LEFT JOIN price_tables pt ON c.priceTableId = pt.id WHERE c.code = ?', [code])
}

export { previewExcelImport, importExcelFromFile, applyExcelImport } from './excel-import'

export function deleteOrderItem(id: number) {
  const item = queryOne('SELECT orderId FROM order_items WHERE id=?', [id])
  if (!item) throw new Error('明细不存在')
  assertDraftOrder(item.orderId)
  run('DELETE FROM order_items WHERE id = ?', [id])
  return { success: true }
}

// ── Order Summary (时间段订单汇总) ──

export function getOrderSummary(dateFrom: string, dateTo: string, status = '') {
  // 详情表：订单号、客户编码、客户名称、商品编码、商品名称、数量、单价、金额
  if (status && !['draft','confirmed','shipped','legacy'].includes(status)) throw new Error('汇总状态无效')
  const details = queryAll(
    `SELECT o.documentNo, o.orderNo, o.receiver, o.status,
            oi.productCode, oi.productName, oi.quantity, oi.price, oi.amount
     FROM order_items oi
     JOIN orders o ON oi.orderId = o.id
     WHERE o.date >= ? AND o.date <= ? AND o.status <> 'voided' AND (? = '' OR o.status = ?)
     ORDER BY o.date ASC, o.id ASC, oi.sortOrder ASC`,
    [dateFrom, dateTo, status, status]
  )

  // 匹配客户编码
  const customers = queryAll('SELECT code, name FROM customers')
  const customerMap: Record<string, string> = {}
  for (const c of customers) {
    customerMap[c.name] = c.code
  }

  const detailRows = details.map((row: any) => ({
    status: row.status,
    documentNo: row.documentNo || '',
    orderNo: row.orderNo || row.documentNo || '',
    customerCode: customerMap[row.receiver] || '',
    customerName: row.receiver || '',
    productCode: row.productCode || '',
    productName: row.productName || '',
    quantity: row.quantity || 0,
    price: row.price || 0,
    amount: row.amount || 0,
  }))

  // 合计表：客户编码、客户名称、商品编码、商品名称、汇总数量、汇总金额
  const combined = new Map<string, { customerCode: string; customerName: string; productCode: string; productName: string; totalQty: number; totalAmt: number }>()

  for (const row of detailRows) {
    const key = JSON.stringify([row.customerCode, row.customerName, row.productCode, row.productName])
    const existing = combined.get(key)
    if (existing) {
      existing.totalQty += row.quantity
      existing.totalAmt += row.amount
    } else {
      combined.set(key, {
        customerCode: row.customerCode,
        customerName: row.customerName,
        productCode: row.productCode,
        productName: row.productName,
        totalQty: row.quantity,
        totalAmt: row.amount,
      })
    }
  }

  const summaryRows = Array.from(combined.values())
    .sort((a, b) => {
      if (a.customerCode !== b.customerCode) return a.customerCode.localeCompare(b.customerCode)
      return a.productCode.localeCompare(b.productCode)
    })

  return { details: detailRows, summary: summaryRows }
}

// ── Price Tables ──

export function getPriceTables() {
  return queryAll('SELECT * FROM price_tables ORDER BY isDefault DESC, name ASC')
}

export function createPriceTable(name: string) {
  const result = run('INSERT INTO price_tables (name, isDefault) VALUES (?, 0)', [name])
  const tableId = result.lastInsertRowid

  // Copy all base product prices into the new price table
  const products = queryAll('SELECT productCode, price FROM products')
  for (const p of products) {
    run(
      'INSERT OR IGNORE INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
      [tableId, p.productCode, p.price]
    )
  }

  return { id: tableId }
}

export function deletePriceTable(id: number) {
  // Cannot delete default table
  const table = queryOne('SELECT * FROM price_tables WHERE id = ?', [id])
  if (!table) return { success: false, message: '价格表不存在' }
  if (table.isDefault) return { success: false, message: '默认价格表不可删除' }

  // Reassign customers using this table to default
  const defaultTable = queryOne('SELECT id FROM price_tables WHERE isDefault = 1')
  if (defaultTable) {
    run('UPDATE customers SET priceTableId = ? WHERE priceTableId = ?', [defaultTable.id, id])
  }

  run('DELETE FROM price_change_log WHERE priceTableId = ?', [id])
  run('DELETE FROM price_table_items WHERE priceTableId = ?', [id])
  run('DELETE FROM price_tables WHERE id = ?', [id])
  return { success: true }
}

export function renamePriceTable(id: number, name: string) {
  const table = queryOne('SELECT * FROM price_tables WHERE id = ?', [id])
  if (!table) return { success: false, message: '价格表不存在' }
  run('UPDATE price_tables SET name = ?, updatedAt = datetime(\'now\',\'localtime\') WHERE id = ?', [name, id])
  return { success: true }
}

// ── Customer Management ──

export function createCustomer(data: { code: string; name: string; address: string; contact?: string; phone?: string; remark?: string; priceTableId?: number }) {
  // Find default price table if not specified
  let priceTableId = data.priceTableId || 0
  if (!priceTableId) {
    const defaultTable = queryOne('SELECT id FROM price_tables WHERE isDefault = 1')
    priceTableId = defaultTable?.id || 0
  }

  const result = run(
    'INSERT INTO customers (code, name, address, contact, phone, remark, priceTableId) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.code, data.name, data.address || '', data.contact || '', data.phone || '', data.remark || '', priceTableId]
  )
  return { id: result.lastInsertRowid }
}

export function updateCustomer(id: number, data: { code?: string; name?: string; address?: string; contact?: string; phone?: string; remark?: string; priceTableId?: number }) {
  const current = queryOne('SELECT * FROM customers WHERE id = ?', [id])
  if (!current) return { success: false, message: '客户不存在' }

  run(
    `UPDATE customers SET code=?, name=?, address=?, contact=?, phone=?, remark=?, priceTableId=? WHERE id=?`,
    [
      data.code ?? current.code,
      data.name ?? current.name,
      data.address ?? current.address,
      data.contact ?? current.contact,
      data.phone ?? current.phone,
      data.remark ?? current.remark,
      data.priceTableId ?? current.priceTableId,
      id,
    ]
  )
  return { success: true }
}

export function deleteCustomer(id: number) {
  const c = queryOne('SELECT code FROM customers WHERE id = ?', [id])
  if (!c) return { success: false }
  run('DELETE FROM customers WHERE id = ?', [id])
  return { success: true }
}

export function getCustomerById(id: number) {
  return queryOne('SELECT c.*, pt.name as priceTableName FROM customers c LEFT JOIN price_tables pt ON c.priceTableId = pt.id WHERE c.id = ?', [id])
}

export function getCustomersByPriceTableId(priceTableId: number) {
  return queryAll(
    'SELECT c.*, pt.name as priceTableName FROM customers c LEFT JOIN price_tables pt ON c.priceTableId = pt.id WHERE c.priceTableId = ? ORDER BY c.code ASC',
    [priceTableId]
  )
}

// ── Price Table Items (Product Prices) ──

export function getPriceTableItems(priceTableId: number) {
  return queryAll(
    `SELECT pt.id as priceTableId, pt.productCode, pt.price, p.productName, p.specification, p.unit, p.brand, p.packageSpec
     FROM price_table_items pt
     LEFT JOIN products p ON pt.productCode = p.productCode
     WHERE pt.priceTableId = ?
     ORDER BY pt.productCode ASC`,
    [priceTableId]
  )
}

export function searchPriceTableItems(priceTableId: number, keyword?: string) {
  if (keyword) {
    const s = `%${keyword}%`
    return queryAll(
      `SELECT pt.priceTableId, pt.productCode, pt.price, p.productName, p.specification, p.unit, p.brand, p.packageSpec
       FROM price_table_items pt
       LEFT JOIN products p ON pt.productCode = p.productCode
       WHERE pt.priceTableId = ? AND (pt.productCode LIKE ? OR p.productName LIKE ? OR p.specification LIKE ?)
       ORDER BY pt.productCode ASC`,
      [priceTableId, s, s, s]
    )
  }
  return getPriceTableItems(priceTableId)
}

export function initPriceTableItems(priceTableId: number) {
  // Copy base prices from products table for this price table
  const existing = queryOne('SELECT COUNT(*) as count FROM price_table_items WHERE priceTableId = ?', [priceTableId])
  if (existing && existing.count > 0) return { success: true }

  const products = queryAll('SELECT productCode, price FROM products')
  for (const p of products) {
    run(
      'INSERT OR IGNORE INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
      [priceTableId, p.productCode, p.price]
    )
  }
  return { success: true }
}

export function updatePriceTableItem(priceTableId: number, productCode: string, newPrice: number) {
  if (!Number.isFinite(newPrice) || newPrice < 0 || newPrice > Number.MAX_SAFE_INTEGER / 100) throw new Error('请输入有效的非负价格')
  return withTransaction(() => {
    const current = queryOne('SELECT price FROM price_table_items WHERE priceTableId = ? AND productCode = ?', [priceTableId, productCode])
    if (!current) return { success: false, message: '未找到该价格记录' }
    run("UPDATE price_table_items SET price = ?, updatedAt = datetime('now','localtime') WHERE priceTableId = ? AND productCode = ?", [newPrice, priceTableId, productCode])
    if (queryOne('SELECT isDefault FROM price_tables WHERE id=?', [priceTableId])?.isDefault) run('UPDATE products SET price=? WHERE productCode=?', [newPrice, productCode])
    run('INSERT INTO price_change_log (priceTableId, productCode, oldPrice, newPrice) VALUES (?, ?, ?, ?)', [priceTableId, productCode, current.price, newPrice])
    return { success: true }
  })
}

export function addPriceTableProduct(priceTableId: number, productCode: string) {
  const existing = queryOne(
    'SELECT * FROM price_table_items WHERE priceTableId = ? AND productCode = ?',
    [priceTableId, productCode]
  )
  if (existing) return { success: false, message: '该产品已在此价格表中' }

  const product = queryOne('SELECT price FROM products WHERE productCode = ?', [productCode])
  const price = product?.price ?? 0

  run(
    'INSERT INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
    [priceTableId, productCode, price]
  )
  return { success: true }
}

export function removePriceTableProduct(priceTableId: number, productCode: string) {
  // Cannot remove from default table
  const table = queryOne('SELECT isDefault FROM price_tables WHERE id = ?', [priceTableId])
  if (table && table.isDefault) return { success: false, message: '默认价格表必须包含所有产品' }
  run('DELETE FROM price_table_items WHERE priceTableId = ? AND productCode = ?', [priceTableId, productCode])
  return { success: true }
}

export function undoLastPriceChange(priceTableId: number) {
  return withTransaction(() => {
    const lastLog = queryOne('SELECT * FROM price_change_log WHERE priceTableId = ? ORDER BY id DESC LIMIT 1', [priceTableId])
    if (!lastLog) return { success: false, message: '没有可撤销的价格修改' }
    run("UPDATE price_table_items SET price = ?, updatedAt = datetime('now','localtime') WHERE priceTableId = ? AND productCode = ?", [lastLog.oldPrice, priceTableId, lastLog.productCode])
    if (queryOne('SELECT isDefault FROM price_tables WHERE id=?', [priceTableId])?.isDefault) run('UPDATE products SET price=? WHERE productCode=?', [lastLog.oldPrice, lastLog.productCode])
    run('DELETE FROM price_change_log WHERE id = ?', [lastLog.id])
    return { success: true, log: lastLog }
  })
}

export function getPriceChangeLogs(priceTableId: number) {
  return queryAll(
    'SELECT * FROM price_change_log WHERE priceTableId = ? ORDER BY id DESC LIMIT 50',
    [priceTableId]
  )
}

// Legacy alias: getCustomerPrices → getPriceTableItems via customer's priceTableId
export function getCustomerPrices(customerCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return []
  return getPriceTableItems(customer.priceTableId)
}

export function initCustomerPrices(customerCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return { success: true }
  return initPriceTableItems(customer.priceTableId)
}

export function updateCustomerPrice(customerCode: string, productCode: string, newPrice: number) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return { success: false, message: '客户不存在' }
  return updatePriceTableItem(customer.priceTableId, productCode, newPrice)
}

export function addCustomerProduct(customerCode: string, productCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return { success: false, message: '客户不存在' }
  return addPriceTableProduct(customer.priceTableId, productCode)
}

export function removeCustomerProduct(customerCode: string, productCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return { success: false, message: '客户不存在' }
  return removePriceTableProduct(customer.priceTableId, productCode)
}

export function searchCustomerPrices(customerCode: string, keyword?: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return []
  return searchPriceTableItems(customer.priceTableId, keyword)
}

export function undoLastPriceChangeByCustomer(customerCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return { success: false, message: '客户不存在' }
  return undoLastPriceChange(customer.priceTableId)
}

export function getPriceChangeLogsByCustomer(customerCode: string) {
  const customer = queryOne('SELECT priceTableId FROM customers WHERE code = ?', [customerCode])
  if (!customer || !customer.priceTableId) return []
  return getPriceChangeLogs(customer.priceTableId)
}

// ═══════════════════════════════════════════════════════════════
// 车间管理 Workshop
// ═══════════════════════════════════════════════════════════════

// Legacy SQL inventory tables are archived; see inventory-service.ts for active inventory.

export function getPrintSettings() {
  const rows = queryAll('SELECT key, value FROM settings')
  const settings: Record<string, string> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }
  return settings
}

export function setPrintSettings(data: Record<string, string | number>) {
  for (const [key, value] of Object.entries(data)) {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)])
  }
  return { success: true }
}
