const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx');
// Only Electron's app path is substituted; database, filesystem and handlers are real.
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { app: { getAppPath: () => path.resolve('.') } };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, file);
const db = require('../electron/database.ts');
const h = require('../electron/handlers.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'order-reliability-'));
const filename = path.join(root, 'orders.db');
before(() => db.initDatabase(filename));
after(() => { db.closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); });
const item = { productName: '测试商品', quantity: 3, price: 1.25, amount: 999 };

test('整单保存重算金额，异常时保留原订单及明细', () => {
  assert.equal(typeof h.saveOrderWithItems, 'function');
  const { id } = h.saveOrderWithItems({ receiver: '测试客户' }, [item]);
  assert.equal(h.getOrderById(id).items[0].amount, 3.75);
  db.getDb().run("CREATE TRIGGER reject_test_item BEFORE INSERT ON order_items WHEN NEW.productName = '拒绝' BEGIN SELECT RAISE(ABORT, '测试写入失败'); END");
  assert.throws(() => h.saveOrderWithItems({ receiver: '修改' }, [item, { ...item, productName: '拒绝' }], id), /测试写入失败/);
  assert.equal(h.getOrderById(id).receiver, '测试客户');
  assert.equal(h.getOrderById(id).items.length, 1);
  db.getDb().run('DROP TRIGGER reject_test_item');
});

test('事务失败不留下半张新订单，数量和价格非法值拒绝', () => {
  assert.equal(typeof h.saveOrderWithItems, 'function');
  const count = h.getOrders().length;
  for (const quantity of [-1, NaN, Infinity]) {
    assert.throws(() => h.saveOrderWithItems({}, [{ ...item, quantity }]));
  }
  assert.equal(h.getOrders().length, count);
  assert.throws(() => h.saveOrderWithItems({}, [item], 999999), /不存在/);
});

test('持久化失败时内存和磁盘均恢复原数据', () => {
  assert.equal(typeof db.withTransaction, 'function');
  const before = h.getOrders().length;
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('磁盘写入失败'); };
    assert.throws(() => db.withTransaction(() => h.createOrder({ receiver: '不可提交' })), /磁盘写入失败/);
  } finally { fs.renameSync = rename; }
  assert.equal(h.getOrders().length, before);
});

test('单条写入遇到磁盘异常也不能在内存留下未提交数据', () => {
  const count = h.getOrders().length;
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('磁盘不可写'); };
    assert.throws(() => h.createOrder({ receiver: '不应保留' }), /磁盘不可写/);
  } finally { fs.renameSync = rename; }
  assert.equal(h.getOrders().length, count);
});

test('库存迁移中途异常整体回滚，并允许重试', () => {
  const inventory = require('../electron/inventory.ts');
  db.getDb().run("CREATE TRIGGER reject_migration BEFORE INSERT ON production_records WHEN NEW.store = 'suppliers' BEGIN SELECT RAISE(ABORT, '迁移中断'); END");
  assert.throws(() => inventory.migrateInventory({ materials: [{ id: 4, quantity: 20 }], suppliers: [{ id: 1, name: '测试' }] }), /迁移中断/);
  assert.equal(inventory.inventoryMigrated(), false);
  assert.equal(inventory.listInventory('materials').length, 0);
  db.getDb().run('DROP TRIGGER reject_migration');
});

test('库存迁移未完成时禁止导入和创建不完整备份', () => {
  const count = db.queryAll('SELECT * FROM products').length;
  assert.equal(h.importExcelFromFile(workbook([['BLOCK', '不可导入', 1]])).success, false);
  assert.equal(db.queryAll('SELECT * FROM products').length, count);
  assert.throws(() => db.createBackup(path.join(root, 'incomplete.db')), /库存/);
  fs.writeFileSync(path.join(root, 'unmigrated.db'), db.getDb().export());
  db.getDb().run('PRAGMA foreign_keys=ON');
});

test('迁移时历史引用的已删除编号也被保留，不指向新对象', () => {
  const inventory = require('../electron/inventory.ts');
  // Force rollback after the assertion to leave the actual migration for the next test.
  assert.throws(() => db.withTransaction(() => {
    inventory.migrateInventory({ materials: [{ id: 1, name: '存活原料' }],
      production_materials: [{ id: 1, material_id: 50, production_id: 90 }],
      stock_logs: [{ id: 1, stock_type: 'finished_product', item_id: 70 }] });
    assert.ok(inventory.putInventory('materials', { name: '新原料' }) > 50);
    assert.ok(inventory.putInventory('productions', { status: 'pending' }) > 90);
    assert.ok(inventory.putInventory('finished_products', { quantity: 0 }) > 70);
    throw new Error('测试结束回滚');
  }), /测试结束回滚/);
});

test('库存迁移保留原 ID、可重试且不能覆盖已迁移数据', () => {
  const inventory = require('../electron/inventory.ts');
  inventory.migrateInventory({ materials: [{ id: 4, name: '测试原料', quantity: 20 }] });
  assert.equal(inventory.listInventory('materials')[0].id, 4);
  inventory.putInventory('materials', { id: 4, name: '测试原料', quantity: 19 });
  inventory.migrateInventory({ materials: [{ id: 4, quantity: 20 }] });
  assert.equal(inventory.listInventory('materials')[0].quantity, 19);
  assert.throws(() => inventory.listInventory('orders'));
});

test('删除最高库存 ID 后不复用旧编号，避免历史关联指向新对象', () => {
  const inventory = require('../electron/inventory.ts');
  const old = inventory.putInventory('suppliers', { name: '旧供应商' });
  inventory.deleteInventory('suppliers', old);
  const fresh = inventory.putInventory('suppliers', { name: '新供应商' });
  assert.ok(fresh > old);
});

test('备份恢复包含订单和库存；无效文件不覆盖现有数据', () => {
  assert.equal(typeof db.createBackup, 'function');
  const inventory = require('../electron/inventory.ts');
  const backup = path.join(root, 'manual.db');
  db.createBackup(backup);
  const count = h.getOrders().length;
  h.createOrder({ receiver: '备份后新增' });
  inventory.putInventory('materials', { id: 4, quantity: 1 });
  db.restoreDatabase(backup);
  assert.equal(h.getOrders().length, count);
  assert.equal(inventory.listInventory('materials')[0].quantity, 19);
  const bad = path.join(root, 'bad.db'); fs.writeFileSync(bad, 'bad database');
  assert.throws(() => db.restoreDatabase(bad));
  assert.equal(h.getOrders().length, count);
  assert.ok(fs.readdirSync(path.join(root, 'backups')).some(n => n.includes('before-restore')));
  assert.throws(() => db.restoreDatabase(path.join(root, 'unmigrated.db')), /库存/);
});

function workbook(products, customers) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['演示价格表'], ['产品编码', '产品名称', '单价（元/件）'], ...products
  ]), '价格表');
  if (customers) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['客户编码', '客户名称', '收货地址'], ...customers
  ]), '客户信息');
  const file = path.join(root, 'import.xlsx'); XLSX.writeFile(wb, file); return file;
}

test('Excel 标题行识别，按编码更新，保留客户价格表和商品 ID', () => {
  assert.equal(typeof h.previewExcelImport, 'function');
  const file = workbook([['TEST-1', '导入商品', 12.5]], [['TEST-C', '导入客户', '测试地址']]);
  const plan = h.previewExcelImport(file);
  assert.equal(plan.products.length, 1);
  assert.equal(h.importExcelFromFile(file).success, true);
  const product = db.queryOne('SELECT * FROM products WHERE productCode = ?', ['TEST-1']);
  const customer = db.queryOne('SELECT * FROM customers WHERE code = ?', ['TEST-C']);
  const table = h.createPriceTable('客户专价');
  h.updateCustomer(customer.id, { ...customer, priceTableId: table.id });
  workbook([['TEST-1', '更新商品', 20]], [['TEST-C', '更新客户', '新地址']]);
  assert.equal(h.importExcelFromFile(file).success, true);
  assert.equal(db.queryOne('SELECT id FROM products WHERE productCode = ?', ['TEST-1']).id, product.id);
  assert.equal(db.queryOne('SELECT priceTableId FROM customers WHERE code = ?', ['TEST-C']).priceTableId, table.id);
});

test('Excel 错误和重复编码显示行号，且不改动原数据', () => {
  const before = db.queryAll('SELECT * FROM products');
  const file = workbook([['TEST-2', '好数据', 10], ['TEST-2', '重复', 1], ['TEST-3', '坏数据', -1]]);
  const result = h.importExcelFromFile(file);
  assert.equal(result.success, false);
  assert.match(result.message, /行/);
  assert.deepEqual(db.queryAll('SELECT * FROM products'), before);
});

test('Excel 未提供的字段保持原值，不把价格、地址和联系方式清空', () => {
  const customer = db.queryOne('SELECT * FROM customers WHERE code = ?', ['TEST-C']);
  h.updateCustomer(customer.id, { ...customer, phone: '测试号码', address: '保留地址' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['产品编码', '产品名称'], ['TEST-1', '仅更新名称']
  ]), '商品');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['客户编码', '客户名称'], ['TEST-C', '仅更新客户名称']
  ]), '客户');
  const file = path.join(root, 'partial.xlsx'); XLSX.writeFile(wb, file);
  assert.equal(h.importExcelFromFile(file).success, true);
  assert.equal(db.queryOne('SELECT price FROM products WHERE productCode = ?', ['TEST-1']).price, 20);
  assert.equal(db.queryOne('SELECT phone FROM customers WHERE code = ?', ['TEST-C']).phone, '测试号码');
  assert.equal(db.queryOne('SELECT address FROM customers WHERE code = ?', ['TEST-C']).address, '保留地址');
});

test('Excel 导入中途数据库异常，全部更新回滚', () => {
  const before = db.queryAll('SELECT * FROM products');
  db.getDb().run("CREATE TRIGGER reject_import BEFORE INSERT ON products WHEN NEW.productCode = 'FAIL' BEGIN SELECT RAISE(ABORT, '导入中断'); END");
  const result = h.importExcelFromFile(workbook([['NEW', '新商品', 1], ['FAIL', '失败商品', 1]]));
  assert.equal(result.success, false);
  assert.deepEqual(db.queryAll('SELECT * FROM products'), before);
  db.getDb().run('DROP TRIGGER reject_import');
});

test('数据库重开后订单与库存仍存在，外键仍有效', async () => {
  assert.equal(typeof h.saveOrderWithItems, 'function');
  const { id } = h.saveOrderWithItems({}, [item]);
  db.closeDatabase(); await db.initDatabase(filename);
  assert.equal(h.getOrderById(id).items[0].amount, 3.75);
  assert.throws(() => h.createOrderItem({ orderId: 999999, ...item }), /FOREIGN KEY/);
  assert.equal(require('../electron/inventory.ts').listInventory('materials')[0].quantity, 19);
});

test('恢复拒绝结构不兼容的 SQLite，启动备份仅保留最近 10 份', async () => {
  const initSQL = require('sql.js');
  const SQL = await initSQL();
  const unrelated = new SQL.Database();
  unrelated.run('CREATE TABLE something_else (id INTEGER)');
  const wrong = path.join(root, 'wrong.db');
  fs.writeFileSync(wrong, unrelated.export()); unrelated.close();
  const count = h.getOrders().length;
  assert.throws(() => db.restoreDatabase(wrong), /表结构不兼容/);
  assert.equal(h.getOrders().length, count);
  for (let i = 0; i < 12; i++) db.automaticBackup();
  const backups = fs.readdirSync(path.join(root, 'backups'));
  assert.equal(backups.filter(n => /-auto-[a-f0-9]+\.db$/.test(n)).length, 10);
  assert.ok(backups.some(n => n.includes('before-restore')));
});

test('打印配置使用毫米转微米，拒绝无效高度', () => {
  const { getPrintOptions } = require('../electron/print-options.ts');
  assert.deepEqual(getPrintOptions({ printPageHeight: '120' }).pageSize, { width: 240000, height: 120000 });
  for (const printPageHeight of ['-1', '151', 'abc', '95.5']) assert.throws(() => getPrintOptions({ printPageHeight }));
});


test('公开演示 Excel 能被实际导入器识别，数量与虚构种子一致', () => {
  const preview = h.previewExcelImport(path.join(__dirname, '../examples/demo-import.xlsx'));
  assert.equal(preview.products.length, 5);
  assert.equal(preview.customers.length, 3);
  assert.equal(preview.products[0].productCode, 'DEMO-P001');
  assert.equal(preview.products[0].price, 48);
  assert.equal(preview.customers[0].phone, '');
});
