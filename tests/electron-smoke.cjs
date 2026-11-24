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
  await evaluate(`window.__leaveConfirmCount=0; window.confirm=()=>{window.__leaveConfirmCount++; return true}; Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '取消').click()`);
  await until('!!document.querySelector(".page-header h1") && document.body.innerText.includes("备份全部数据")');
  assert.equal(await evaluate(`window.electronAPI.getOrderById(${id}).then(o => o.items.length)`), 11);
  reports.push('取消编辑保留 11 条原始明细');
  assert.ok(await evaluate('window.__leaveConfirmCount >= 1'),'leaving edited order asks first');
  await evaluate(`window.electronAPI.saveOrderDefaults({sender:'开单默认测试单位',warehouse:'默认库',maker:'默认制单人'})`);
  await evaluate(`document.querySelector('.page-header .btn-primary').click()`);
  await until(`document.querySelector('[aria-label="发货单位"]')?.value === '开单默认测试单位'`);
  assert.equal(await evaluate(`document.querySelector('details.order-more').open`),false);
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="制单人"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'已修改');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(30);
  await evaluate(`window.confirm=()=>false; Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='取消').click()`);
  await wait(100);
  assert.match(await evaluate(`location.hash`),/orders\/new/);
  await evaluate(`window.confirm=()=>true; Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='取消').click()`);
  await until(`document.body.innerText.includes('备份全部数据')`);
  await until(`!!document.querySelector('.order-more-trigger')`);
  await evaluate(`document.querySelector('.order-more-trigger').click()`);
  await until(`!!document.querySelector('.order-more-dialog')`);
  await evaluate(`Array.from(document.querySelectorAll('.order-more-dialog button')).find(b=>b.textContent==='复制为新草稿').click()`);
  await until(`document.querySelectorAll('button.btn-danger').length===11`);
  const copiedNo=await evaluate(`document.querySelector('[aria-label="单据编号"]').value`);
  assert.notEqual(copiedNo,'TEST-001');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='取消').click()`);
  await until(`document.body.innerText.includes('备份全部数据')`);
  assert.equal(handlers.getOrders().length,1,'cancelling a copy does not create an order');
  reports.push('开单默认值、可选信息折叠、未保存离开确认和复制新单号通过');

  require(path.join(appRoot,'dist-electron/inventory.js')).putInventory('materials', {id:1,name:'烟测原料',quantity:10});
  await evaluate('window.electronAPI.createBackup()');
  require(path.join(appRoot,'dist-electron/inventory.js')).putInventory('materials', {id:1,name:'烟测原料',quantity:5});
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
  window.webContents.getPrintersAsync = async () => [
    {name:'Test Printer A',displayName:'测试打印机 A',isDefault:true,status:0,options:{}},
    {name:'Test Printer B',displayName:'测试打印机 B',isDefault:false,status:0,options:{}},
  ];
  let printCalls = 0;
  let lastOptions;
  window.webContents.print = (options, callback) => {
    printCalls++; lastOptions = options;
    callback(false, '烟测打印机失败');
  };
  const ready = async () => {
    await until(`!!document.querySelector('.print-settings-button:not(:disabled)') && document.querySelector('.print-area')?.getAttribute('aria-busy')==='false'`);
  };
  const field = async (label, value, select = false) => {
    await evaluate(`(async()=>{
      const input = document.querySelector('[aria-label="${label}"]');
      const proto = ${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));
      await new Promise(r=>setTimeout(r,0));
    })()`);
  };
  const openSettings = async (print = false) => {
    await evaluate(`document.querySelector('.toolbar ${print ? '.btn-primary' : '.print-settings-button'}').click()`);
    await until(`!!document.querySelector('[role="dialog"]')`);
  };
  const apply = async (print = false) => {
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.includes('${print ? '确认规格，进入系统打印' : '应用并查看预览'}')).click()`);
    await until(`!document.querySelector('[role="dialog"]')`);
    await ready();
  };
  const pdfFor = async (profile, name) => {
    const bytes = await window.webContents.printToPDF({preferCSSPageSize:true, printBackground:true,
      landscape:profile.orientation==='landscape', pageSize:{width:profile.widthMm/25.4,height:profile.heightMm/25.4}});
    fs.writeFileSync(path.join(root,name+'.pdf'),bytes);
    const text = bytes.toString('latin1');
    const physical = (text.match(/\/Type \/Page\b/g) || []).length;
    assert.equal(physical, await evaluate(`document.querySelectorAll('.print-page').length`), name+' pages match preview');
    const dimensions = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)][0][1].trim().split(/\s+/).map(Number);
    const width = profile.orientation==='landscape' ? profile.heightMm : profile.widthMm;
    const height = profile.orientation==='landscape' ? profile.widthMm : profile.heightMm;
    assert.ok(Math.abs(dimensions[2]-width/25.4*72)<2, name+' physical width');
    assert.ok(Math.abs(dimensions[3]-height/25.4*72)<2, name+' physical height');
    return physical;
  };
  await evaluate(`window.location.hash = '/orders/${id}/print'`);
  await ready();
  const defaultProfile = await evaluate(`window.electronAPI.getPrintConfiguration().then(c=>c.active)`);
  assert.equal(await pdfFor(defaultProfile,'print-95'),2);
  fs.writeFileSync(path.join(root,'print.png'),(await window.webContents.capturePage()).toPNG());
  await openSettings(true);
  assert.equal(printCalls,0,'opening the prompt must not start printing');
  assert.match(await evaluate(`document.querySelector('[role="dialog"]').innerText`),/100%/);
  await field('打印机','Test Printer A',true);
  await field('纸张规格','a4',true);
  await field('方向','landscape',true);
  await field('字号（磅）',12);
  await field('上边距（mm）',5);
  await field('下边距（mm）',5);
  await field('左边距（mm）',5);
  await field('右边距（mm）',5);
  await field('打印份数',2);
  await apply(false);
  assert.equal(printCalls,0,'applying the preview must not start printing');
  const a4 = await evaluate(`window.electronAPI.getPrintConfiguration().then(c=>c.active)`);
  assert.equal(a4.printerName,'Test Printer A'); assert.equal(a4.orientation,'landscape');
  assert.equal(a4.widthMm,210); assert.equal(a4.heightMm,297); assert.equal(a4.copies,2);
  await pdfFor(a4,'print-a4-landscape');
  await openSettings(true);
  assert.match(await evaluate(`document.querySelector('[role="dialog"]').innerText`),/横向/);
  await apply(true);
  await until(`document.body.innerText.includes('烟测打印机失败')`);
  assert.equal(printCalls,1); assert.equal(lastOptions.deviceName,'Test Printer A');
  assert.equal(lastOptions.copies,2); assert.equal(lastOptions.landscape,true);
  assert.equal(lastOptions.scaleFactor,100); assert.equal(lastOptions.margins.marginType,'none');
  assert.deepEqual(lastOptions.pageSize,{width:210000,height:297000});
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',ctrlKey:true,cancelable:true}))`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(printCalls,1,'Ctrl+P must ask before submitting');
  await apply(true);
  await until(`document.querySelector('.toolbar .btn-primary:not(:disabled)') && document.body.innerText.includes('烟测打印机失败')`);
  assert.equal(printCalls,2);
  reports.push('打印按钮与 Ctrl+P 都先确认规格，预览不打印；确认后使用同一份方向/纸型/份数并显示错误');

  await openSettings();
  await field('打印机','Test Printer B',true);
  await field('纸张规格','continuous',true);
  await field('纸张宽度（mm）',216);
  await field('纸张高度（mm）',140);
  await field('字号（磅）',10);
  await apply();
  await openSettings();
  await field('打印机','Test Printer A',true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="纸张高度（mm）"]').value`),'297');
  assert.equal(await evaluate(`document.querySelector('[aria-label="方向"]').value`),'landscape');
  await apply();
  assert.equal(await evaluate(`window.electronAPI.getPrintConfiguration().then(c=>c.profiles['Test Printer B'].heightMm)`),140);
  reports.push('切换打印机能恢复各自的纸张、方向和字号配置');

  await openSettings();
  await field('纸张宽度（mm）',80); await field('纸张高度（mm）',50);
  await field('方向','portrait',true); await field('左边距（mm）',40); await field('右边距（mm）',40);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.includes('应用并查看预览')).disabled`),true);
  await evaluate(`document.querySelector('[aria-label="关闭打印设置"]').click()`);
  assert.equal(printCalls,2);
  reports.push('无效边距阻止提交，不产生打印任务');

  for (const scenario of [
    {widthMm:240,heightMm:70,orientation:'portrait',fontSizePt:10},
    {widthMm:240,heightMm:150,orientation:'portrait',fontSizePt:11},
    {widthMm:210,heightMm:297,orientation:'portrait',fontSizePt:12},
    {widthMm:216,heightMm:140,orientation:'portrait',fontSizePt:10},
    {widthMm:148,heightMm:210,orientation:'landscape',fontSizePt:9},
  ]) {
    const profile = {...defaultProfile,...scenario,printerName:'',preset:'custom',maxRowsPerPage:50};
    await evaluate(`window.electronAPI.savePrinterProfile(${JSON.stringify(profile)})`);
    await evaluate(`window.location.hash = '/'`); await until(`!document.querySelector('.print-page')`);
    await evaluate(`window.location.hash = '/orders/${id}/print'`); await ready();
    assert.equal(await evaluate(`document.querySelector('.error-message')?.innerText || ''`),'');
    await pdfFor(profile,`print-${scenario.widthMm}-${scenario.heightMm}-${scenario.orientation}`);
  }
  reports.push('连续纸、自定义纸张、A4 及 A5 横向：字号/边距变化后预览与 PDF 物理尺寸、页数一致');
  const overflow = {...defaultProfile,preset:'custom',widthMm:80,heightMm:50,fontSizePt:18,maxRowsPerPage:50};
  await evaluate(`window.electronAPI.savePrinterProfile(${JSON.stringify(overflow)})`);
  await evaluate(`window.location.hash = '/'`); await until(`!document.querySelector('.print-page')`);
  await evaluate(`window.location.hash = '/orders/${id}/print'`); await ready();
  assert.match(await evaluate(`document.body.innerText`), /超出/);
  await openSettings(true); await apply(true);
  await until(`!!document.querySelector('.toolbar .btn-primary:not(:disabled)')`);
  assert.equal(printCalls,2,'overflowing content must not be sent to a printer');
  await assert.rejects(evaluate(`window.electronAPI.printWindow({...${JSON.stringify(defaultProfile)},printerName:'Unavailable Printer'})`),/不可用/);
  assert.equal(printCalls,2,'an unavailable printer must not fall back silently');
  reports.push('过小纸张内容溢出或打印机不可用时阻止发送，避免截断或误投其他打印机');
  await evaluate(`window.location.hash = '/'`); await until(`!document.querySelector('.print-page')`);
  await evaluate(`window.electronAPI.savePrinterProfile(${JSON.stringify(defaultProfile)})`);
  const emptyId = await evaluate(`window.electronAPI.saveOrderWithItems({documentNo:'EMPTY'},[]).then(o=>o.id)`);
  await evaluate(`window.location.hash = '/orders/${emptyId}/print'`); await ready();
  assert.equal(await pdfFor(defaultProfile,'print-empty'),1);
  reports.push('空订单打印一页');

  await openSettings();
  await field('方案名称','联单方案');
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='收藏当前规格').click()`);
  await until(`document.querySelector('[aria-label="收藏方案"]').options.length===2`);
  await field('纸张规格','a4',true); await field('方案名称','A4方案');
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='收藏当前规格').click()`);
  await until(`document.querySelector('[aria-label="收藏方案"]').options.length===3`);
  const favorite = await evaluate(`window.electronAPI.getPrintConfiguration().then(c=>c.favorites.find(f=>f.name==='联单方案').id)`);
  await field('收藏方案',favorite,true); await apply();
  await openSettings();
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.includes('打印校准页')).click()`);
  await until(`!document.querySelector('[role="dialog"]') && document.body.innerText.includes('打印规格校准页') && document.querySelector('.print-area')?.getAttribute('aria-busy')==='false'`);
  await until(`!!document.querySelector('.toolbar .btn-primary:not(:disabled)')`);
  assert.equal(lastOptions.copies,1);
  const square = await evaluate(`document.querySelector('.calibration-sheet rect[width="10"]').getBoundingClientRect().width`);
  assert.ok(Math.abs(square-10*96/25.4)<1);
  assert.equal(await pdfFor(defaultProfile,'calibration'),1);
  reports.push('同机多方案收藏与应用通过；校准页10mm方框、单份打印和PDF尺寸通过');

  const core = require(path.join(appRoot,'dist-electron/inventory.js'));
  const stockId = core.putInventory('finished_products',{product_name:'UI发货成品',product_code:'FLOW-P',unit:'件',quantity:10});
  const flowId = await evaluate(`window.electronAPI.saveOrderWithItems({receiver:'测试客户',orderNo:'FLOW-UI'},[{productCode:'FLOW-P',productName:'UI发货成品',unit:'件',quantity:2,price:5}]).then(o=>o.id)`);
  await evaluate(`location.hash='/'`); await until(`document.body.innerText.includes('FLOW-UI')`);
  const actionButton = async text => {
    // Closing an action dialog starts an async list refresh; wait for its new state.
    await until(`Array.from(document.querySelectorAll('tbody tr')).some(r=>r.innerText.includes('FLOW-UI') && r.querySelector('.order-more-trigger'))`);
    if (text==='作废') {
      await evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(r=>r.innerText.includes('FLOW-UI')).querySelector('.order-more-trigger').click()`);
      await until(`!!document.querySelector('.order-more-dialog')`);
      await evaluate(`Array.from(document.querySelectorAll('.order-more-dialog button')).find(b=>b.textContent==='退货并作废').click()`);
    } else {
      await until(`Array.from(document.querySelectorAll('tbody tr')).some(r=>r.innerText.includes('FLOW-UI') && Array.from(r.querySelectorAll('button')).some(b=>b.textContent==='${text}'))`);
      await evaluate(`(()=>{const row=Array.from(document.querySelectorAll('tbody tr')).find(r=>r.innerText.includes('FLOW-UI'));Array.from(row.querySelectorAll('button')).find(b=>b.textContent==='${text}').click()})()`);
    }
    await until(`!!document.querySelector('.order-action-dialog')`);
  };
  const confirmAction = async () => { await until(`!!document.querySelector('.order-action-dialog .btn-primary:not(:disabled)')`); await evaluate(`document.querySelector('.order-action-dialog .btn-primary').click()`); await until(`!document.querySelector('.order-action-dialog')`); };
  await actionButton('确认订单'); await confirmAction();
  assert.equal(core.listInventory('finished_products').find(p=>p.id===stockId).quantity,10);
  await actionButton('整单发货');
  const lineId = handlers.getOrderById(flowId).items[0].id;
  await until(`!!document.querySelector('[aria-label="发货库存-${lineId}"]')`);
  await field(`发货库存-${lineId}`,stockId,true); await confirmAction();
  assert.equal(core.listInventory('finished_products').find(p=>p.id===stockId).quantity,8);
  await actionButton('作废'); await field('作废原因','测试整单退回');
  await evaluate(`document.querySelector('.order-action-dialog input[type="checkbox"]').click()`); await confirmAction();
  assert.equal(core.listInventory('finished_products').find(p=>p.id===stockId).quantity,10);
  assert.equal(handlers.getOrderById(flowId).status,'voided');
  reports.push('订单列表UI确认不扣库存，选择批次整单发货扣减，确认退回作废恢复库存');

  const productionId=await evaluate(`window.electronAPI.putInventory('productions',{order_id:0,order_no:'外部演示任务',status:'pending',manager:'测试'},true)`);
  await evaluate(`window.electronAPI.inventoryOperation('production.start',{productionId:${productionId}},'ui-start')`);
  await evaluate(`window.electronAPI.inventoryOperation('production.complete',{productionId:${productionId}},'ui-complete')`);
  await evaluate(`window.__newModule.toggleNewSystem()`);
  await wait(150);
  await evaluate(`window.__newModule.showWarehouseDialog(${productionId});document.getElementById('fp-name').value='UI生产入库';document.getElementById('fp-qty').value='3';`);
  await evaluate(`window.__newModule.confirmWarehouse(${productionId})`);
  assert.equal(core.listInventory('productions').find(p=>p.id===productionId).status,'warehoused');
  assert.equal(core.listInventory('finished_products').find(p=>p.production_id===productionId).quantity,3);
  reports.push('旧生产界面的成品入库已通过统一事务，成品数量、任务状态及流水同步提交');

  await evaluate(`window.__newModule.toggleNewSystem()`);
  // Reproduce a bottom-row menu at a small window size and view an upgraded order.
  const legacyIds = Array.from({length: 10}, (_, i) => handlers.saveOrderWithItems({
    receiver:'历史演示客户', orderNo:'HISTORY-UI-'+i, sender:'历史演示发货方', remark:'历史备注',
  }, [{productName:'历史商品快照',specification:'200g',packageSpec:'1x12',unit:'件',quantity:2,price:9.5}]).id);
  for (const oldId of legacyIds) database.run("UPDATE orders SET status='legacy' WHERE id=?",[oldId]);
  window.setContentSize(1000,640);
  await evaluate(`location.hash='/order-summary'`); await until(`!document.querySelector('.order-action-dialog') && document.body.innerText.includes('订单汇总')`);
  await evaluate(`location.hash='/'`); await until(`document.body.innerText.includes('HISTORY-UI-9')`);
  await evaluate(`(()=>{const rows=Array.from(document.querySelectorAll('tbody tr'));const row=rows.find(r=>r.innerText.includes('HISTORY-UI-9'));row.scrollIntoView({block:'end'});const button=Array.from(row.querySelectorAll('button,summary')).find(b=>b.textContent.trim()==='更多');button.click();})()`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  const menuVisible = await evaluate(`(()=>{const dialog=document.querySelector('[role="dialog"]'); const buttons=Array.from(dialog.querySelectorAll('button'));return buttons.every(b=>{const r=b.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))});})()`);
  assert.equal(menuVisible,true,'all bottom-row actions must be visible and clickable');
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.trim()==='关闭').click()`);
  const legacyId=legacyIds[9];
  await evaluate(`location.hash='/orders/${legacyId}'`);
  await until(`!!document.querySelector('[data-testid="order-detail"]')`);
  const historicalText=await evaluate('document.body.innerText');
  for(const expected of ['历史演示客户','历史演示发货方','历史商品快照','1x12','19.00','历史备注','发货状态未记录']) assert.ok(historicalText.includes(expected),expected);
  assert.equal(await evaluate(`document.querySelectorAll('[data-order-primary-action]').length`),0,'legacy records must not expose stock-changing actions');
  assert.equal(handlers.getOrderById(legacyId).status,'legacy');
  const visibleDraft=handlers.saveOrderWithItems({receiver:'明显状态客户',orderNo:'VISIBLE-DRAFT'},[{productName:'状态明细',quantity:1,price:1}]).id;
  await evaluate(`location.hash='/'`); await until(`document.body.innerText.includes('VISIBLE-DRAFT')`);
  assert.equal(await evaluate(`(()=>{const row=Array.from(document.querySelectorAll('tbody tr')).find(r=>r.innerText.includes('VISIBLE-DRAFT'));return Array.from(row.querySelectorAll('[data-order-primary-action]')).some(b=>b.textContent==='确认订单' && b.getBoundingClientRect().width>0)})()`),true);
  await evaluate(`location.hash='/orders/${visibleDraft}/view'`);
  await until(`!!document.querySelector('[data-testid="order-detail"] [data-order-primary-action]')`);
  await evaluate(`document.querySelector('[data-order-primary-action]').click()`);await confirmAction();
  await until(`document.querySelector('[data-testid="order-detail"] [data-order-primary-action]')?.textContent==='整单发货'`);
  assert.equal(handlers.getOrderById(visibleDraft).status,'confirmed');
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="order-detail"] button')).find(b=>b.textContent==='退回草稿').click()`);await confirmAction();
  await until(`document.querySelector('[data-testid="order-detail"] [data-order-primary-action]')?.textContent==='确认订单'`);
  assert.equal(handlers.getOrderById(visibleDraft).status,'draft');
  reports.push('小窗口底行更多操作完整可见；历史详情展示快照和状态说明；列表及详情直接确认并可退回草稿');
  console.log(JSON.stringify({ passed: reports, artifactDirectory: root }, null, 2));
  app.exit(0);
}
setTimeout(() => { console.error('Smoke test timeout'); app.exit(1); }, 45000);
run().catch(error => { console.error(error); console.error('Artifacts:', root); app.exit(1); });
