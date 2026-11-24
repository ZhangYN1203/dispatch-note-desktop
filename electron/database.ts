import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let SQL: Awaited<ReturnType<typeof initSqlJs>>
let transactionDepth = 0

export async function initDatabase(databasePath: string): Promise<void> {
  // Locate sql-wasm.wasm - works both in dev and packaged
  const wasmPath = path.join(process.resourcesPath || app.getAppPath(), 'sql-wasm.wasm')
  SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (fs.existsSync(wasmPath)) {
        return wasmPath
      }
      // Fallback to node_modules for dev
      return path.join(__dirname, '../node_modules/sql.js/dist/', file)
    },
  })
  dbPath = databasePath
  const newDatabase = !fs.existsSync(dbPath)

  // Ensure directory exists
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Open existing DB or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Preserve the exact pre-upgrade file before any schema or persisted data changes.
  if (!newDatabase) {
    const oldOrders = db.exec('PRAGMA table_info(orders)')[0]?.values || []
    const oldItems = db.exec('PRAGMA table_info(order_items)')[0]?.values || []
    if (oldOrders.length && (!oldOrders.some(row => row[1] === 'status') || !oldItems.some(row => row[1] === 'packageSpec'))) {
      const backupDir = path.join(dir, 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(dbPath, path.join(backupDir, `${stamp}-schema-upgrade.db`), fs.constants.COPYFILE_EXCL)
    }
  }

  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documentNo TEXT NOT NULL DEFAULT '',
      orderNo TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      senderPhone TEXT NOT NULL DEFAULT '',
      receiver TEXT NOT NULL DEFAULT '',
      receiverContact TEXT NOT NULL DEFAULT '',
      receiverPhone TEXT NOT NULL DEFAULT '',
      receiverAddress TEXT NOT NULL DEFAULT '',
      carrierVehicle TEXT NOT NULL DEFAULT '',
      carrierName TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      outTime TEXT NOT NULL DEFAULT '',
      tonnage TEXT NOT NULL DEFAULT '',
      mileage TEXT NOT NULL DEFAULT '',
      maker TEXT NOT NULL DEFAULT '',
      reviewer TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL DEFAULT '',
      productCode TEXT NOT NULL DEFAULT '',
      productName TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      packageSpec TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      priceTableId INTEGER NOT NULL DEFAULT 0
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productCode TEXT NOT NULL DEFAULT '',
      productName TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_table_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priceTableId INTEGER NOT NULL DEFAULT 0,
      productCode TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(priceTableId, productCode)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priceTableId INTEGER NOT NULL DEFAULT 0,
      productCode TEXT NOT NULL DEFAULT '',
      oldPrice REAL NOT NULL DEFAULT 0,
      newPrice REAL NOT NULL DEFAULT 0,
      changedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  // ── Settings table (key-value store for print settings, etc.) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `)

  db.run(`CREATE TABLE IF NOT EXISTS production_records (
    store TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(store, id)
  )`)

  // ── New tables: workshops, raw materials, inventory ──

  db.run(`
    CREATE TABLE IF NOT EXISTS workshops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      materialCode TEXT NOT NULL DEFAULT '',
      materialName TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS material_inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inboundNo TEXT NOT NULL DEFAULT '',
      materialId INTEGER NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      operator TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      inboundDate TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS material_outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outboundNo TEXT NOT NULL DEFAULT '',
      workshopId INTEGER NOT NULL DEFAULT 0,
      materialId INTEGER NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      operator TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      outboundDate TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS product_inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inboundNo TEXT NOT NULL DEFAULT '',
      productId INTEGER NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      inboundType TEXT NOT NULL DEFAULT '',  -- 'purchase' 采购 / 'production' 生产
      operator TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      inboundDate TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemType TEXT NOT NULL DEFAULT '',  -- 'raw_material' / 'product'
      itemId INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT '',  -- 'inbound' / 'outbound'
      quantity REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 0,
      refId INTEGER NOT NULL DEFAULT 0,
      refType TEXT NOT NULL DEFAULT '',  -- 'material_inbound' / 'material_outbound' / 'product_inbound' / 'order_outbound'
      operator TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  if (!queryAll('PRAGMA table_info(orders)').some(column => column.name === 'status')) {
    withTransaction(() => getDb().run("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'legacy'"))
  }
  getDb().run(`CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, fromStatus TEXT NOT NULL, toStatus TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL)`)
  getDb().run(`CREATE TABLE IF NOT EXISTS order_shipments (orderId INTEGER NOT NULL, itemId INTEGER NOT NULL, stockId INTEGER NOT NULL, quantity REAL NOT NULL, returned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(orderId,itemId))`)
  getDb().run(`CREATE TABLE IF NOT EXISTS inventory_requests (id TEXT PRIMARY KEY, signature TEXT NOT NULL, result TEXT NOT NULL)`)
  getDb().run("CREATE UNIQUE INDEX IF NOT EXISTS idx_new_order_document ON orders(documentNo) WHERE status <> 'legacy' AND documentNo <> ''")

  if (!queryAll('PRAGMA table_info(products)').some(column => column.name === 'packageSpec')) {
    getDb().run("ALTER TABLE products ADD COLUMN packageSpec TEXT NOT NULL DEFAULT ''")
  }

  // Persist invoice packaging once; subsequent reads never join live catalog data.
  if (!queryAll('PRAGMA table_info(order_items)').some(column => column.name === 'packageSpec')) {
    withTransaction(() => {
      getDb().run("ALTER TABLE order_items ADD COLUMN packageSpec TEXT NOT NULL DEFAULT ''")
      getDb().run("UPDATE order_items SET packageSpec=COALESCE((SELECT products.packageSpec FROM products WHERE products.productCode=order_items.productCode LIMIT 1),'')")
    })
  }

  // ── Migration: add missing columns ──
  try { db.run('ALTER TABLE customers ADD COLUMN remark TEXT NOT NULL DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE customers ADD COLUMN priceTableId INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE price_change_log ADD COLUMN priceTableId INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE price_change_log ADD COLUMN productCode TEXT NOT NULL DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE price_change_log ADD COLUMN oldPrice REAL NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE price_change_log ADD COLUMN newPrice REAL NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE price_change_log ADD COLUMN changedAt TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\'))') } catch {}
  try { db.run('ALTER TABLE products ADD COLUMN packageSpec TEXT NOT NULL DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE products ADD COLUMN stockQuantity REAL NOT NULL DEFAULT 0') } catch {}

  // ── Ensure default price table exists ──
  let defaultTable = queryOne('SELECT id FROM price_tables WHERE isDefault = 1')
  if (!defaultTable) {
    const r = run('INSERT INTO price_tables (name, isDefault) VALUES (?, 1)', ['默认价格表'])
    defaultTable = { id: r.lastInsertRowid }

    // Copy all base product prices into the default price table
    const products = queryAll('SELECT productCode, price FROM products')
    for (const p of products) {
      run(
        'INSERT OR IGNORE INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
        [defaultTable.id, p.productCode, p.price]
      )
    }
  }

  // ── Migration: if any customer has priceTableId=0, assign them to default ──
  const orphans = queryAll('SELECT id FROM customers WHERE priceTableId = 0')
  for (const c of orphans) {
    run('UPDATE customers SET priceTableId = ? WHERE id = ?', [defaultTable.id, c.id])
  }

  // ── Seed default data (products & customers) ──
  const productCount = queryOne('SELECT COUNT(*) as count FROM products')?.count || 0
  if (newDatabase && productCount === 0) {
    seedDefaultData(defaultTable.id)
  }

  saveDb()
  console.log(`Database initialized at: ${dbPath}`)
}

function seedDefaultData(defaultTableId: number): void {
  // ── Products (价目表) ──
  // Fictional fixtures only. Do not add customer or company production data here.
  const products: [string, string, string, string, string, string, number][] = [
    ['演示品牌', 'DEMO-P001', '示例调味酱', '200g', '1x12', '件', 48.00],
    ['演示品牌', 'DEMO-P002', '示例米醋', '500ml', '1x12', '件', 36.00],
    ['演示品牌', 'DEMO-P003', '示例酱油', '500ml', '1x12', '件', 42.00],
    ['演示品牌', 'DEMO-P004', '示例礼盒', '4瓶装', '1x6', '盒', 88.00],
    ['演示品牌', 'DEMO-P005', '示例包装袋', '通用', '1x100', '包', 15.00],
  ]

  for (const [brand, code, name, spec, pkg, unit, price] of products) {
    run(
      'INSERT INTO products (brand, productCode, productName, specification, packageSpec, unit, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [brand, code, name, spec, pkg, unit, price]
    )
    // Also insert into default price table
    run(
      'INSERT INTO price_table_items (priceTableId, productCode, price) VALUES (?, ?, ?)',
      [defaultTableId, code, price]
    )
  }

  // ── Customers (客户信息) ──
  const customers: [string, string, string, string, string][] = [
    ['DEMO-C001', '示例客户 A', '示例市演示路 1 号（虚构）', '联系人 A', ''],
    ['DEMO-C002', '示例客户 B', '示例市演示路 2 号（虚构）', '联系人 B', ''],
    ['DEMO-C003', '示例零售客户', '演示门店（虚构）', '', ''],
  ]

  for (const [code, name, address, contact, phone] of customers) {
    run(
      'INSERT INTO customers (code, name, address, contact, phone, remark, priceTableId) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, name, address, contact, phone, '', defaultTableId]
    )
  }

  console.log(`Seeded ${products.length} products and ${customers.length} customers`)
}

function exportDb(): Uint8Array {
  const bytes = getDb().export()
  // sql.js export reopens the database and resets connection PRAGMAs.
  getDb().run('PRAGMA foreign_keys = ON')
  return bytes
}

function atomicWrite(target: string, bytes: Uint8Array): void {
  const temporary = target + '.tmp'
  try {
    const fd = fs.openSync(temporary, 'w')
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function saveDb(): void {
  if (db && dbPath && transactionDepth === 0) atomicWrite(dbPath, exportDb())
}

// Synchronous business operations only. Persist exactly once after the whole operation.
export function withTransaction<T>(operation: () => T): T {
  if (transactionDepth > 0) return operation()
  const snapshot = exportDb()
  transactionDepth++
  try {
    getDb().run('BEGIN TRANSACTION')
    const result = operation()
    getDb().run('COMMIT')
    transactionDepth--
    saveDb()
    return result
  } catch (error) {
    transactionDepth = 0
    db?.close()
    db = new SQL.Database(snapshot)
    db.run('PRAGMA foreign_keys = ON')
    throw error
  }
}

export function createBackup(target: string): void {
  if (queryOne("SELECT value FROM settings WHERE key = 'inventoryMigrated'")?.value !== '1') throw new Error('库存数据迁移尚未完成，不能创建不完整备份')
  if (path.resolve(target) === path.resolve(dbPath)) throw new Error('不能覆盖当前数据库')
  atomicWrite(target, exportDb())
}

export function automaticBackup(reason = 'auto'): string {
  const dir = path.join(path.dirname(dbPath), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}-${Math.random().toString(16).slice(2, 8)}.db`)
  createBackup(file)
  // Only startup backups are rotated; pre-import and pre-restore backups are retained.
  const autoFiles = fs.readdirSync(dir).filter(n => /-auto-[a-f0-9]+\.db$/.test(n)).sort().reverse()
  for (const old of autoFiles.slice(10)) fs.unlinkSync(path.join(dir, old))
  return file
}

export function restoreDatabase(source: string): void {
  if (path.resolve(source) === path.resolve(dbPath)) throw new Error('不能恢复当前正在使用的数据库文件')
  const candidate = new SQL.Database(fs.readFileSync(source))
  try {
    if (candidate.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('备份文件已损坏')
    // Validate every current table and column before touching live data.
    const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    for (const { name } of tables) {
      const columns = queryAll(`PRAGMA table_info("${name}")`).map(row => row.name)
      const restored = candidate.exec(`PRAGMA table_info("${name}")`)[0]
      if (!restored || columns.some(col => !restored.values.some(row => row[1] === col))) {
        throw new Error('备份表结构不兼容，请使用当前版本创建的备份')
      }
    }
    if (candidate.exec('PRAGMA foreign_key_check').length) throw new Error('备份中存在无效的数据关联')
    if (candidate.exec("SELECT value FROM settings WHERE key = 'inventoryMigrated'")[0]?.values[0]?.[0] !== '1') throw new Error('该备份未完成库存迁移，不能作为完整备份恢复')
    candidate.run('PRAGMA foreign_keys = ON')
    automaticBackup('before-restore')
    const previous = db
    db = candidate
    try { saveDb() } catch (error) { db = previous; throw error }
    previous?.close()
  } finally {
    if (db !== candidate) candidate.close()
  }
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

export function persistDb(): void {
  saveDb()
}

// Helper: run a query and return all rows as objects
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: any[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

// Helper: run a query and return first row as object
export function queryOne(sql: string, params: any[] = []): any | null {
  const rows = queryAll(sql, params)
  return rows.length > 0 ? rows[0] : null
}

// Helper: run an INSERT/UPDATE/DELETE and return info
export function run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number } {
  if (transactionDepth === 0) return withTransaction(() => run(sql, params))
  const db = getDb()
  db.run(sql, params)
  const lastInsertRowid = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) || 0
  const changes = db.getRowsModified()
  saveDb()
  return { changes, lastInsertRowid }
}

export function closeDatabase(): void {
  if (db) {
    saveDb()
    db.close()
    db = null
  }
}
