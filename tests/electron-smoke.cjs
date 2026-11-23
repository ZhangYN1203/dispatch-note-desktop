// Run with Electron, using an isolated temporary userData directory.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'order-electron-smoke-'));
app.setPath('userData', root);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];
const appRoot = process.env.ORDER_PRINT_PACKAGED_RESOURCES ? path.join(process.env.ORDER_PRINT_PACKAGED_RESOURCES, 'app.asar') : path.resolve(__dirname, '..');
if (process.env.ORDER_PRINT_PACKAGED_RESOURCES) process.resourcesPath = process.env.ORDER_PRINT_PACKAGED_RESOURCES;
let savePath = path.join(root, 'manual.db');
let openPath = savePath;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPath] });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showErrorBox = (title, detail) => { console.error(title, detail); app.exit(1); };
app.on('browser-window-created', (_event, window) => window.hide());


async function run() {
  await app.whenReady();
  const seed = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  const seedFile = path.join(root, 'seed.html'); fs.writeFileSync(seedFile, '<!doctype html><title>Migration test</title>');
  await seed.loadFile(seedFile);
  await seed.webContents.executeJavaScript(`new Promise((resolve,reject) => {
    const request = indexedDB.open('ProductionManagementDB', 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('materials', {keyPath:'id',autoIncrement:true});
      request.result.createObjectStore('suppliers', {keyPath:'id',autoIncrement:true});
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(['materials','suppliers'],'readwrite');
      tx.objectStore('materials').put({id:7,name:'迁移原料',quantity:42,supplier_id:3});
      tx.objectStore('suppliers').put({id:3,name:'迁移供应商'});
      tx.oncomplete = () => {database.close(); resolve();};
      tx.onerror = () => reject(tx.error);
    };
  })`);
  require(path.join(appRoot, 'dist-electron/main.js'));
  let window;
  for (let i = 0; i < 100; i++) {
    window = BrowserWindow.getAllWindows().find(w => w !== seed);
    if (window && !window.webContents.isLoading()) break;
    await wait(100);
  }
  assert.ok(window, 'window exists');
  seed.destroy();
  const evaluate = code => window.webContents.executeJavaScript(code);
  const until = async (code) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await wait(50); }
    throw new Error('Timed out: ' + code);
  };
  window.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('Renderer:', message); });
  await until('!!window.electronAPI && !!window.inventoryReady');
  await evaluate('window.inventoryReady');
  const migrated = await evaluate(`window.electronAPI.listInventory('materials')`);
  assert.equal(migrated[0].id, 7);
  assert.equal(migrated[0].supplier_id, 3);
  assert.equal(migrated[0].quantity, 42);
  reports.push('真实 IndexedDB 首次迁移保留原编号及供应商关联');
  await until('!!document.querySelector(".page-header")');
  assert.match(await evaluate('document.body.innerText'), /备份全部数据/);
  const id = await evaluate(`(async () => {
    const items = Array.from({length: 11}, (_, i) => ({productName:'测试商品'+i, quantity:1, price:1.25}));
    return (await window.electronAPI.saveOrderWithItems({ documentNo: 'TEST-001', receiver:'测试客户', receiverAddress:'测试地址' }, items)).id;
  })()`);
  const handlers = require(path.join(appRoot, 'dist-electron/handlers.js'));
  const database = require(path.join(appRoot, 'dist-electron/database.js'));
  const emptyTable = handlers.createPriceTable('测试空价表');
  database.run('DELETE FROM price_table_items WHERE priceTableId=?', [emptyTable.id]);
  handlers.createCustomer({code:'READONLY', name:'测试客户', address:'测试地址', priceTableId:emptyTable.id});
  await evaluate(`window.location.hash = '/orders/${id}'`);
  await until('!!document.querySelector(".items-table") || !!document.querySelector(".order-items-table") || document.body.innerText.includes("商品明细")');
  await wait(300);
  assert.equal(handlers.getCustomerPrices('READONLY').length, 0, 'opening the editor must not initialize or write prices');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '删除').click()`);
  assert.equal(await evaluate(`window.electronAPI.getOrderById(${id}).then(o => o.items.length)`), 11, 'deleting an unsaved row leaves DB unchanged');
  const rowCount = await evaluate(`document.querySelectorAll('button.btn-danger').length`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('添加商品')).click()`);
  await until(`document.querySelectorAll('button.btn-danger').length === ${rowCount + 1}`);
  await evaluate(`Array.from(document.querySelectorAll('button.btn-danger')).at(-1).click()`);
  assert.equal(await evaluate(`document.querySelectorAll('button.btn-danger').length`), rowCount, 'new-row temporary ID must not collide with a loaded row');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '取消').click()`);
  await until('!!document.querySelector(".page-header h1") && document.body.innerText.includes("备份全部数据")');
  assert.equal(await evaluate(`window.electronAPI.getOrderById(${id}).then(o => o.items.length)`), 11);
  reports.push('取消编辑保留 11 条原始明细');
  await evaluate(`window.electronAPI.putInventory('materials', {id: 1, name: '烟测原料', quantity: 10})`);
  await evaluate('window.electronAPI.createBackup()');
  await evaluate(`window.electronAPI.putInventory('materials', {id: 1, name: '烟测原料', quantity: 5})`);
  await evaluate('window.electronAPI.restoreBackup()');
  assert.equal(await evaluate(`window.electronAPI.listInventory('materials').then(rows => rows[0].quantity)`), 10);
  reports.push('真实 IPC 备份恢复包含库存');
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['产品编码','产品名称','单价'],['SMOKE-IMPORT','导入测试商品',2.5]]), '商品');
  openPath = path.join(root, 'smoke-import.xlsx'); XLSX.writeFile(wb, openPath);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('导入商品与客户')).click()`);
  await until(`document.body.innerText.includes('导入成功')`);
  assert.equal(database.queryOne('SELECT price FROM products WHERE productCode=?', ['SMOKE-IMPORT']).price, 2.5);
  reports.push('首页 Excel 导入入口完成文件选择、预览确认和数据库写入');
  await evaluate(`window.location.hash = '/orders/${id}/print'`);
  await until('document.querySelectorAll(".print-page").length === 2');
  await until('!!document.querySelector(".print-height-control input:not(:disabled)")');
  await evaluate('document.fonts.ready');
  const pdf = await window.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: {top:0,bottom:0,left:0,right:0} });
  fs.writeFileSync(path.join(root, 'print.pdf'), pdf);
  fs.writeFileSync(path.join(root, 'print.png'), (await window.webContents.capturePage()).toPNG());
  const pdfText = pdf.toString('latin1');
  const pages = (pdfText.match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages, 2, '11 items print as exactly 2 physical pages');
  const boxes = [...pdfText.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(m => m[1]);
  assert.ok(boxes.length >= 2);
  const dims = boxes[0].trim().split(/\s+/).map(Number);
  assert.ok(Math.abs(dims[2] - 240 / 25.4 * 72) < 2);
  assert.ok(Math.abs(dims[3] - 95 / 25.4 * 72) < 2);
  reports.push('11 条商品生成 2 页 240×95mm PDF');
  // Avoid real print dialogs; verify the application's button and Ctrl+P reach the same handler.
  let printCalls = 0;
  window.webContents.print = (options, callback) => {
    printCalls++;
    assert.equal(options.pageSize.height, 95000);
    callback(false, '烟测打印机失败');
  };
  await evaluate(`document.querySelector('.toolbar .btn-primary').click()`);
  await until(`document.body.innerText.includes('烟测打印机失败')`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',ctrlKey:true,cancelable:true}))`);
  await wait(300);
  assert.equal(printCalls, 2);
  reports.push('按钮和 Ctrl+P 共用打印配置，显示打印错误');
  for (const height of [70, 150]) {
    await evaluate(`window.electronAPI.setPrintSettings({printPageHeight:'${height}'})`);
    await evaluate(`window.location.hash = '/'`);
    await until('!document.querySelector(".print-page")');
    await evaluate(`window.location.hash = '/orders/${id}/print'`);
    await until(`!!document.querySelector('.print-height-control input:not(:disabled)') && document.querySelector('.print-height-control input').value === '${height}'`);
    await wait(350);
    const logicalPages = await evaluate(`document.querySelectorAll('.print-page').length`);
    const boundary = await window.webContents.printToPDF({preferCSSPageSize:true, printBackground:true});
    assert.equal((boundary.toString('latin1').match(/\/Type \/Page\b/g) || []).length, logicalPages, `${height}mm physical pages match preview`);
    fs.writeFileSync(path.join(root, `print-${height}.pdf`), boundary);
  }
  reports.push('70mm 和 150mm 边界纸张：预览与物理页数一致');
  await evaluate(`window.location.hash = '/'`);
  await until('!document.querySelector(".print-page")');
  const emptyId = await evaluate(`window.electronAPI.saveOrderWithItems({documentNo:'EMPTY'},[]).then(o=>o.id)`);
  await evaluate(`window.location.hash = '/orders/${emptyId}/print'`);
  await until('!!document.querySelector(".print-height-control input:not(:disabled)")');
  const emptyPdf = await window.webContents.printToPDF({preferCSSPageSize:true, printBackground:true});
  assert.equal((emptyPdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  reports.push('空订单打印为一页');
  console.log(JSON.stringify({ passed: reports, artifactDirectory: root }, null, 2));
  app.exit(0);
}
setTimeout(() => { console.error('Smoke test timeout'); app.exit(1); }, 45000);
run().catch(error => { console.error(error); console.error('Artifacts:', root); app.exit(1); });
