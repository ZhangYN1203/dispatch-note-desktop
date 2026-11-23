// Regenerate README screenshots in an isolated, disposable application profile.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-note-demo-'));
app.setPath('userData', profile);
const output = path.resolve(__dirname, '../docs/images');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_event, window) => window.hide());
dialog.showErrorBox = (title, detail) => { console.error(title, detail); app.exit(1); };
require('../dist-electron/main.js');
async function capture() {
  await app.whenReady();
  let window;
  for (let attempt = 0; attempt < 100; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading()) break;
    await wait(100);
  }
  if (!window) throw new Error('Application window unavailable');
  window.setContentSize(1440, 1120);
  const js = code => window.webContents.executeJavaScript(code);
  const until = async code => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await js(code)) return; await wait(50); }
    throw new Error('Timed out: ' + code);
  };
  await until('!!window.inventoryReady && !!window.electronAPI');
  await js('window.inventoryReady');
  const database = require('../dist-electron/database.js');
  const handlers = require('../dist-electron/handlers.js');
  const products = database.queryAll('SELECT * FROM products ORDER BY productCode');
  const id = handlers.saveOrderWithItems({ documentNo: 'DEMO-20261123-001', orderNo: 'DEMO-001', date: '2026-11-23',
    sender: '示例发货单位（虚构）', receiver: '示例客户 A', receiverAddress: '示例市演示路 1 号（虚构）',
    receiverContact: '联系人 A', warehouse: '演示成品库', maker: '演示制单员', remark: '仅用于项目演示，全部资料为虚构。' },
  products.map((product, index) => ({ ...product, quantity: [12, 8, 10, 4, 2][index], price: product.price }))).id;
  for (let i = 2; i <= 4; i++) handlers.saveOrderWithItems({ documentNo: `DEMO-20261123-00${i}`, orderNo: `DEMO-00${i}`, date: '2026-11-23',
    sender: '示例发货单位（虚构）', receiver: i % 2 ? '示例客户 A' : '示例客户 B', warehouse: '演示成品库' },
  products.slice(0, i - 1).map(product => ({ ...product, quantity: i * 2 })));
  const table = handlers.createPriceTable('演示客户 B 价格表');
  const customer = database.queryOne('SELECT * FROM customers WHERE code=?', ['DEMO-C002']);
  handlers.updateCustomer(customer.id, { ...customer, priceTableId: table.id });
  handlers.updatePriceTableItem(table.id, products[0].productCode, 45);
  fs.mkdirSync(output, { recursive: true });
  const screenshot = async (name, route, ready) => {
    await js(`window.location.hash = ${JSON.stringify(route)}`);
    await until(ready);
    await js('document.fonts.ready');
    await wait(450);
    const height = Math.min(1120, Math.ceil(await js(`(() => {
      const pages = document.querySelectorAll('.print-page');
      const last = pages.length ? pages[pages.length-1] : document.querySelector('.page-container');
      return last ? last.getBoundingClientRect().bottom + 20 : 1120;
    })()`)));
    fs.writeFileSync(path.join(output, name + '.png'), (await window.webContents.capturePage({x:0,y:0,width:1440,height})).toPNG());
  };
  // Reload list so it reads the newly created fixtures.
  await js(`window.location.reload()`);
  await until(`document.body.innerText.includes('DEMO-001')`);
  await screenshot('orders', '/', `document.body.innerText.includes('DEMO-001')`);
  await screenshot('editor', `/orders/${id}`, `document.body.innerText.includes('商品明细') && document.querySelectorAll('.btn-danger').length >= 5`);
  await screenshot('print', `/orders/${id}/print`, `!!document.querySelector('.print-height-control input:not(:disabled)')`);
  await js(`window.location.hash = '/product-manager'`);
  await until(`Array.from(document.querySelectorAll('span')).some(s=>s.textContent==='演示客户 B 价格表')`);
  await js(`Array.from(document.querySelectorAll('span')).find(s=>s.textContent==='演示客户 B 价格表').parentElement.click()`);
  await screenshot('prices', '/product-manager', `document.body.innerText.includes('示例调味酱')`);
  console.log('Demo screenshots saved to docs/images; all data is fictional.');
  app.exit(0);
}
setTimeout(() => { console.error('Screenshot timeout'); app.exit(1); }, 45000);
capture().catch(error => { console.error(error); app.exit(1); });
