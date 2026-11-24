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
  assert.throws(() => db.getDb().run('INSERT INTO order_items (orderId) VALUES (999999)'), /FOREIGN KEY/);
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
  for (const printPageHeight of ['-1', '601', 'abc']) assert.throws(() => getPrintOptions({ printPageHeight }));
});


test('公开演示 Excel 能被实际导入器识别，数量与虚构种子一致', () => {
  const preview = h.previewExcelImport(path.join(__dirname, '../examples/demo-import.xlsx'));
  assert.equal(preview.products.length, 5);
  assert.equal(preview.customers.length, 3);
  assert.equal(preview.products[0].productCode, 'DEMO-P001');
  assert.equal(preview.products[0].price, 48);
  assert.equal(preview.customers[0].phone, '');
});


test('每台打印机分别保存规格，并保留当前选择', () => {
  const { getPrintConfiguration, savePrinterProfile } = require('../electron/printer-config.ts');
  const { normalizePrintProfile } = require('../electron/print-profile.ts');
  savePrinterProfile(normalizePrintProfile({ printerName: 'Printer A', widthMm: 240, heightMm: 140 }));
  savePrinterProfile(normalizePrintProfile({ printerName: 'Printer B', widthMm: 210, heightMm: 297 }));
  const config = getPrintConfiguration();
  assert.equal(config.active.printerName, 'Printer B');
  assert.equal(config.profiles['Printer A'].heightMm, 140);
  assert.equal(config.profiles['Printer B'].heightMm, 297);
});

test('保存打印规格中途失败时当前设置与历史配置一起回滚', () => {
  const { getPrintConfiguration, savePrinterProfile } = require('../electron/printer-config.ts');
  const before = getPrintConfiguration();
  db.getDb().run("CREATE TRIGGER reject_profile BEFORE INSERT ON settings WHEN NEW.key='printerProfilesV2' BEGIN SELECT RAISE(ABORT,'配置写入失败'); END");
  assert.throws(() => savePrinterProfile({ ...before.active, heightMm: 300 }), /配置写入失败/);
  assert.deepEqual(getPrintConfiguration(), before);
  db.getDb().run('DROP TRIGGER reject_profile');
});

test('开单默认值只接受可复用字段，保存失败不覆盖旧值', () => {
  const defaults = require('../electron/order-defaults.ts');
  defaults.saveOrderDefaults({ sender: '演示默认单位', warehouse: '默认仓库', maker: '制单员' });
  assert.equal(defaults.getOrderDefaults().warehouse, '默认仓库');
  assert.throws(() => defaults.saveOrderDefaults({ receiver: '不可设为默认的客户' }));
  assert.equal(defaults.getOrderDefaults().sender, '演示默认单位');
});

test('同一打印机可收藏多套方案，删除收藏不改变当前规格', () => {
  const config = require('../electron/printer-config.ts');
  const { normalizePrintProfile } = require('../electron/print-profile.ts');
  const before = config.getPrintConfiguration().active;
  const a = config.savePrintFavorite('联单', normalizePrintProfile({ printerName: '收藏打印机' }));
  config.savePrintFavorite('A4', normalizePrintProfile({ printerName: '收藏打印机', preset: 'a4', widthMm: 210, heightMm: 297 }));
  assert.equal(config.getPrintConfiguration().favorites.length, 2);
  config.deletePrintFavorite(a.id);
  assert.equal(config.getPrintConfiguration().favorites.length, 1);
  assert.deepEqual(config.getPrintConfiguration().active, before);
});

test('箱规写入明细快照，商品修改不会改变旧单打印内容', () => {
  const product = h.createProduct({ productCode: 'SNAP', productName: '原商品', specification: '100g', packageSpec: '1x12', unit: '件', price: 10 });
  const order = h.saveOrderWithItems({}, [{ productCode: 'SNAP', productName: '原商品', specification: '100g', quantity: 2, price: 10 }]);
  h.updateProduct(product.id, { packageSpec: '1x24', specification: '200g', price: 20 });
  const saved = h.getOrderById(order.id).items[0];
  assert.equal(saved.packageSpec, '1x12'); assert.equal(saved.specification, '100g'); assert.equal(saved.price, 10);
});

test('库存业务把数量与流水一起提交，中断回滚，同请求不重复入库', () => {
  const service = require('../electron/inventory-service.ts');
  const inventory = require('../electron/inventory.ts');
  const id = inventory.putInventory('materials', { name: '事务测试原料', quantity: 5, unit: 'kg' });
  service.executeInventoryOperation('material.inbound', { materialId: id, quantity: 2 }, 'inbound-once');
  service.executeInventoryOperation('material.inbound', { materialId: id, quantity: 2 }, 'inbound-once');
  assert.equal(service.getEntity('materials', id).quantity, 7);
  db.getDb().run("CREATE TRIGGER reject_stock_log BEFORE INSERT ON production_records WHEN NEW.store='stock_logs' BEGIN SELECT RAISE(ABORT,'流水失败'); END");
  assert.throws(() => service.executeInventoryOperation('material.inbound', { materialId: id, quantity: 3 }, 'inbound-rollback'), /流水失败/);
  assert.equal(service.getEntity('materials', id).quantity, 7);
  db.getDb().run('DROP TRIGGER reject_stock_log');
  service.executeInventoryOperation('material.inbound', { materialId: id, quantity: 3 }, 'inbound-rollback');
  assert.equal(service.getEntity('materials', id).quantity, 10);
});

test('领料校验最新库存与生产状态，不能负数出库或覆盖余额', () => {
  const service = require('../electron/inventory-service.ts');
  const inventory = require('../electron/inventory.ts');
  const materialId = inventory.putInventory('materials', { name: '原料', quantity: 3 });
  const workshopId = inventory.putInventory('workshops', { name: '车间' });
  const productionId = inventory.putInventory('productions', { status: 'production', order_id: 0 });
  assert.throws(() => service.executeInventoryOperation('material.outbound', { materialId, workshopId, quantity: -1 }, 'negative'));
  assert.throws(() => service.executeInventoryOperation('material.outbound', { materialId, workshopId, quantity: 4 }, 'overstock'), /库存不足/);
  service.executeInventoryOperation('material.outbound', { materialId, workshopId, productionId, quantity: 2 }, 'use-once');
  assert.equal(service.getEntity('materials', materialId).quantity, 1);
  assert.throws(() => service.saveInventoryEntity('materials', { ...service.getEntity('materials', materialId), quantity: 99 }), /库存/);
});

test('订单确认不扣库存，发货整单扣减一次；确认退回后作废恢复一次', () => {
  const workflow = require('../electron/order-workflow.ts');
  const inventory = require('../electron/inventory.ts');
  const service = require('../electron/inventory-service.ts');
  const stockId = inventory.putInventory('finished_products', { product_name: '测试成品', product_code: 'SHIP', quantity: 10, unit: '件' });
  const order = h.saveOrderWithItems({ receiver: '测试客户' }, [{ ...item, productCode: 'SHIP', unit: '件', quantity: 3 }]);
  workflow.transitionOrder(order.id, 'confirmed');
  assert.equal(service.getEntity('finished_products', stockId).quantity, 10);
  assert.throws(() => h.saveOrderWithItems({}, [item], order.id), /草稿/);
  const allocations = [{ itemId: h.getOrderById(order.id).items[0].id, stockId }];
  workflow.transitionOrder(order.id, 'shipped', { allocations });
  assert.equal(service.getEntity('finished_products', stockId).quantity, 7);
  assert.throws(() => workflow.transitionOrder(order.id, 'shipped', { allocations }));
  assert.throws(() => workflow.transitionOrder(order.id, 'voided', { reason: '退货' }), /退回/);
  workflow.transitionOrder(order.id, 'voided', { reason: '货物退回', returnStock: true });
  assert.equal(service.getEntity('finished_products', stockId).quantity, 10);
  assert.throws(() => workflow.transitionOrder(order.id, 'voided', { reason: '重复', returnStock: true }));
  assert.equal(workflow.getOrderEvents(order.id).length, 3);
});

test('整单多商品发货中途失败，状态、所有库存与发货明细全部回滚', () => {
  const workflow = require('../electron/order-workflow.ts');
  const inventory = require('../electron/inventory.ts');
  const service = require('../electron/inventory-service.ts');
  const a = inventory.putInventory('finished_products', { product_name: '成品A', quantity: 10, unit: '件' });
  const b = inventory.putInventory('finished_products', { product_name: '成品B', quantity: 1, unit: '件' });
  const order = h.saveOrderWithItems({ receiver: '测试客户' }, [{ ...item, unit: '件', quantity: 2 }, { ...item, unit: '件', quantity: 2 }]);
  workflow.transitionOrder(order.id, 'confirmed');
  const lines = h.getOrderById(order.id).items;
  assert.throws(() => workflow.transitionOrder(order.id, 'shipped', { allocations: [{ itemId: lines[0].id, stockId: a }, { itemId: lines[1].id, stockId: b }] }), /库存不足/);
  assert.equal(service.getEntity('finished_products', a).quantity, 10);
  assert.equal(h.getOrderById(order.id).status, 'confirmed');
  assert.equal(db.queryAll('SELECT * FROM order_shipments WHERE orderId=?', [order.id]).length, 0);
});

test('旧明细接口和发货边界都拒绝负数量，生产状态随整批发货与退回同步', () => {
  const workflow = require('../electron/order-workflow.ts');
  const inventory = require('../electron/inventory.ts');
  const order = h.createOrder({ receiver: '测试客户' });
  assert.throws(() => h.createOrderItem({ orderId: order.id, ...item, quantity: -3 }));
  const line = h.createOrderItem({ orderId: order.id, ...item, quantity: 3 });
  assert.throws(() => h.updateOrderItem(line.id, { quantity: -3 }));
  const productionId = inventory.putInventory('productions', { status: 'warehoused' });
  const stockId = inventory.putInventory('finished_products', { product_name: '成品', quantity: 3, production_id: productionId });
  workflow.transitionOrder(order.id, 'confirmed');
  workflow.transitionOrder(order.id, 'shipped', { allocations: [{ itemId: line.id, stockId }] });
  assert.equal(inventory.listInventory('productions').find(p => p.id === productionId).status, 'shipped');
  workflow.transitionOrder(order.id, 'voided', { reason: '退回', returnStock: true });
  assert.equal(inventory.listInventory('productions').find(p => p.id === productionId).status, 'warehoused');
});


test('状态边界再次拒绝损坏数量，汇总保留小数并排除作废', () => {
  const workflow = require('../electron/order-workflow.ts');
  const order = h.saveOrderWithItems({ receiver: '汇总客户', date: '2099-01-02' }, [{ ...item, quantity: 1.25 }]);
  db.run('UPDATE order_items SET quantity=-1 WHERE orderId=?', [order.id]);
  assert.throws(() => workflow.transitionOrder(order.id, 'confirmed'), /数量/);
  db.run('UPDATE order_items SET quantity=1.25 WHERE orderId=?', [order.id]);
  workflow.transitionOrder(order.id, 'confirmed');
  const summary = h.getOrderSummary('2099-01-01', '2099-01-03', 'confirmed');
  assert.equal(summary.details.length, 1);
  assert.equal(summary.details[0].quantity, 1.25);
  workflow.transitionOrder(order.id, 'voided', { reason: '取消' });
  assert.equal(h.getOrderSummary('2099-01-01', '2099-01-03').details.length, 0);
});

test('旧版数据库升级先保留原文件，历史订单不追溯扣库存且箱规只回填一次', async () => {
  db.closeDatabase();
  const initSQL = require('sql.js');
  const SQL = await initSQL();
  const legacy = new SQL.Database(fs.readFileSync(filename));
  legacy.run('DROP INDEX idx_new_order_document');
  legacy.run('ALTER TABLE orders DROP COLUMN status');
  legacy.run('ALTER TABLE order_items DROP COLUMN packageSpec');
  legacy.run("INSERT INTO orders(documentNo,receiver) VALUES('OLD-DUP','历史客户'),('OLD-DUP','历史客户')");
  legacy.run("INSERT INTO products(productCode,packageSpec) VALUES('OLD-SNAP','1x8')");
  legacy.run("INSERT INTO order_items(orderId,productCode,quantity,price) VALUES((SELECT MAX(id) FROM orders),'OLD-SNAP',2,1)");
  const bytes = Buffer.from(legacy.export()); legacy.close();
  fs.writeFileSync(filename, bytes);
  await db.initDatabase(filename);
  const backups = fs.readdirSync(path.join(root, 'backups')).filter(n => n.endsWith('-schema-upgrade.db'));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'backups', backups[0])), bytes);
  const historical = db.queryOne("SELECT id,status FROM orders WHERE documentNo='OLD-DUP' ORDER BY id DESC LIMIT 1");
  assert.equal(historical.status, 'legacy');
  assert.throws(() => h.updateOrder(historical.id, { receiver: '修改' }), /草稿/);
  assert.equal(h.getOrderById(historical.id).items[0].packageSpec, '1x8');
  db.run("UPDATE products SET packageSpec='1x16' WHERE productCode='OLD-SNAP'");
  db.closeDatabase(); await db.initDatabase(filename);
  assert.equal(h.getOrderById(historical.id).items[0].packageSpec, '1x8');
  assert.equal(fs.readdirSync(path.join(root, 'backups')).filter(n => n.endsWith('-schema-upgrade.db')).length, 1);
  const created = h.createOrder({ documentNo: 'OLD-DUP' });
  assert.equal(h.getOrderById(created.id).status, 'draft');
  assert.notEqual(h.getOrderById(created.id).documentNo, 'OLD-DUP');
});
