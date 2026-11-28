const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const artifact=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-audit-'));
app.setPath('userData',artifact);
app.on('browser-window-created',(_e,w)=>w.hide());
dialog.showErrorBox=(t,d)=>{console.error(t,d);app.exit(1)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let w;const reports=[];
const ev=c=>w.webContents.executeJavaScript(c);
async function until(c){for(let i=0;i<100;i++){if(await ev(c))return;await sleep(40)}throw Error('Timeout '+c)}
async function click(text,scope='document'){await ev(`(()=>{const b=Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing '+${JSON.stringify(text)});b.click()})()`);await sleep(70)}
async function field(label,value){await ev(`(()=>{const f=Array.from(document.querySelectorAll('.confirm-dialog .form-field')).find(f=>f.querySelector('label')?.textContent.trim()===${JSON.stringify(label)});const el=f?.querySelector('input,textarea,select');if(!el)throw Error('Field missing '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await sleep(30)}
async function input(selector,value){await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100)}
async function nav(route){await ev(`location.hash=${JSON.stringify(route)}`);await sleep(140)}
async function chip(name){await ev(`Array.from(document.querySelectorAll('.price-table-chip')).find(c=>c.textContent.includes(${JSON.stringify(name)})).click()`);await sleep(120)}
async function test(name,fn){try{await fn();reports.push({name,status:'PASS'});}catch(e){reports.push({name,status:'FAIL',error:e.message,body:await ev('document.body.innerText')});}console.log(JSON.stringify(reports.at(-1)));}
async function run(){
 await app.whenReady();require('../dist-electron/main.js');
 for(let i=0;i<100;i++){w=BrowserWindow.getAllWindows()[0];if(w&&!w.webContents.isLoading())break;await sleep(60)}
 await until(`!!document.querySelector('[data-system-choice="orders"]')`);
 await ev(`document.querySelector('[data-system-choice="orders"]').click()`);
 await until(`!!document.querySelector('.workspace-header')`);
 const h=require('../dist-electron/handlers.js');
 h.createProduct({productCode:'AUD-001',productName:'验收商品甲',specification:'100g',packageSpec:'1x12',unit:'件',price:10,brand:'原品牌'});
 h.createProduct({productCode:'AUD-002',productName:'验收商品乙',specification:'200g',packageSpec:'1x24',unit:'件',price:20});
 const snapshot=h.saveOrderWithItems({documentNo:'CATALOG-SNAPSHOT',receiver:'模拟客户'},[{productCode:'AUD-001',productName:'验收商品甲',specification:'100g',packageSpec:'1x12',unit:'件',quantity:2,price:10,brand:'原品牌'}]);
 await nav('/product-manager');await until(`!!document.querySelector('.price-table-chip')`);
 let table;
 await test('价格表新增、重命名、取消',async()=>{
  await click('+ 新建价格表');await field('价格表名称','验收专属价格');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`document.body.innerText.includes('验收专属价格 - 商品列表')`);
  table=h.getPriceTables().find(t=>t.name==='验收专属价格');assert.ok(table);
  await click('重命名');await field('价格表名称','验收专属改名');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`document.body.innerText.includes('验收专属改名 - 商品列表')`);
  await click('重命名');await field('价格表名称','不得保存');await click('取消',`document.querySelector('.confirm-dialog')`);assert.equal(h.getPriceTables().find(t=>t.id===table.id).name,'验收专属改名');
 });
 await test('客户新增、价格表分配、编辑取消、修改保存与搜索',async()=>{
  await nav('/customer-manager');await ev('void (window.confirm=()=>true)');await click('+ 添加客户');await field('客户编码 *','AUD-C1');await field('客户名称 *','模拟验收客户');await field('收货地址 *','模拟地址1');await field('联系人','模拟联系人');await field('电话','123456');await field('关联价格表',table.id);await field('备注','验收备注');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!!document.querySelector('.customer-card')`);
  assert.equal(h.searchCustomers('AUD-C1')[0].priceTableId,table.id);await ev(`document.querySelector('.customer-card').click()`);await click('编辑');await field('客户名称 *','取消的修改');await click('取消',`document.querySelector('.confirm-dialog')`);assert.equal(h.searchCustomers('AUD-C1')[0].name,'模拟验收客户');
  await click('编辑');await field('客户名称 *','模拟验收客户改');await field('收货地址 *','模拟地址改');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`document.body.innerText.includes('客户信息已更新')`);assert.equal(h.searchCustomers('AUD-C1')[0].address,'模拟地址改');
  await ev(`document.querySelector('[aria-label="关闭客户详情"]').click()`);await input('input[placeholder="搜索客户编码、名称..."]','不存在');await until(`document.body.innerText.includes('未找到匹配客户')`);await input('input[placeholder="搜索客户编码、名称..."]','AUD-C1');await until(`!!document.querySelector('.customer-card')`);
 });
 await nav('/product-manager');await until(`!!document.querySelector('.price-table-chip')`);await chip('验收专属改名');
 const row=`Array.from(document.querySelectorAll('.items-editor tbody tr')).find(r=>r.innerText.includes('AUD-001'))`;
 await test('专属价修改、取消、记录、撤销及基础价隔离',async()=>{
  await click('修改价格',row);await input('input[aria-label="商品单价 AUD-001"]','9.25');await click('取消',row);assert.equal(h.getPriceTableItems(table.id).find(p=>p.productCode==='AUD-001').price,10);
  await click('修改价格',row);await input('input[aria-label="商品单价 AUD-001"]','9.25');await click('保存',row);await until(`!document.querySelector('input[aria-label="商品单价 AUD-001"]')`);assert.equal(h.getPriceTableItems(table.id).find(p=>p.productCode==='AUD-001').price,9.25);assert.equal(h.searchProducts('AUD-001')[0].price,10);
  await click('修改记录');assert.equal(h.getPriceChangeLogs(table.id)[0].newPrice,9.25);await click('撤销上次修改');await until(`document.body.innerText.includes('已撤销')`);assert.equal(h.getPriceTableItems(table.id).find(p=>p.productCode==='AUD-001').price,10);
 });
 await test('价格表商品移除确认、取消及从默认表重新添加',async()=>{
  await click('删除',row);await click('取消',`document.querySelector('.confirm-dialog')`);assert.ok(h.getPriceTableItems(table.id).some(p=>p.productCode==='AUD-001'));
  await click('删除',row);await click('确认',`document.querySelector('.confirm-dialog')`);await until(`!(${row})`);assert.equal(h.getPriceTableItems(table.id).some(p=>p.productCode==='AUD-001'),false);
  await click('+ 从默认价格表添加产品');await input('input[placeholder="搜索产品..."]','AUD-001');await until(`!!document.querySelector('.dropdown-item-primary')`);await ev(`document.querySelector('.dropdown-item').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await until(`!!(${row})`);assert.equal(h.getPriceTableItems(table.id).find(p=>p.productCode==='AUD-001').price,10);
 });
 await chip('默认');
 await test('商品编辑编码名称箱规、价格表同步、历史快照保留',async()=>{
  await click('商品信息',row);await field('产品编码 *','AUD-RENAMED');await field('产品名称 *','验收商品已改');await field('整箱规格','1x30');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`document.body.innerText.includes('AUD-RENAMED')`);
  assert.equal(h.searchProducts('AUD-RENAMED')[0].packageSpec,'1x30');assert.ok(h.getPriceTableItems(table.id).some(p=>p.productCode==='AUD-RENAMED'&&p.productName==='验收商品已改'&&p.packageSpec==='1x30'));
  const old=h.getOrderById(snapshot.id).items[0];assert.equal(old.productCode,'AUD-001');assert.equal(old.productName,'验收商品甲');assert.equal(old.packageSpec,'1x12');
 });
 await test('商品品牌修改持久化',async()=>{
  await click('商品信息',`Array.from(document.querySelectorAll('.items-editor tbody tr')).find(r=>r.innerText.includes('AUD-RENAMED'))`);await field('品牌','修改后的品牌');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!document.querySelector('.confirm-dialog')`);assert.equal(h.searchProducts('AUD-RENAMED')[0].brand,'修改后的品牌');
 });
 await test('商品编码、名称、规格搜索与空结果恢复',async()=>{
  const selector=await ev(`Array.from(document.querySelectorAll('input')).find(i=>i.placeholder.includes('编码'))?.placeholder`);
  assert.ok(selector);for(const q of ['AUD-RENAMED','验收商品已改','100g']){await input('input[placeholder='+JSON.stringify(selector)+']',q);assert.equal(await ev('document.querySelectorAll(".items-editor tbody tr").length'),1)}
  await input('input[placeholder='+JSON.stringify(selector)+']','无匹配商品');assert.equal(await ev('document.querySelectorAll(".items-editor tbody tr").length'),0);await input('input[placeholder='+JSON.stringify(selector)+']','');assert.equal(await ev('document.querySelectorAll(".items-editor tbody tr").length'),h.searchProducts().length);
 });
 await test('商品重复编码阻止保存、编辑取消',async()=>{
  const r=`Array.from(document.querySelectorAll('.items-editor tbody tr')).find(r=>r.innerText.includes('AUD-RENAMED'))`;
  await click('商品信息',r);await field('产品编码 *','AUD-002');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`document.body.innerText.includes('产品编码「AUD-002」已存在')`);assert.ok(h.searchProducts('AUD-RENAMED').some(p=>p.productCode==='AUD-RENAMED'));await click('取消',`document.querySelector('.confirm-dialog')`);
 });
 await test('商品改编码后专属价撤销仍可恢复',async()=>{
  await chip('验收专属改名');const r=`Array.from(document.querySelectorAll('.items-editor tbody tr')).find(r=>r.innerText.includes('AUD-RENAMED'))`;
  await click('修改价格',r);await input('input[aria-label="商品单价 AUD-RENAMED"]','8.75');await click('保存',r);await until(`!document.querySelector('input[aria-label="商品单价 AUD-RENAMED"]')`);
  await chip('默认');await click('商品信息',r);await field('产品编码 *','AUD-RENAMED2');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!document.querySelector('.confirm-dialog')`);await chip('验收专属改名');await click('撤销上次修改');await until(`document.body.innerText.includes('已撤销')`);assert.equal(h.getPriceTableItems(table.id).find(p=>p.productCode==='AUD-RENAMED2').price,10);
 });
 await chip('验收专属改名');
 await test('删除有客户的价格表预告影响、取消、确认自动切默认',async()=>{
  await click('删除');await until(`!!document.querySelector('.confirm-dialog')`);assert.match(await ev(`document.querySelector('.confirm-dialog').innerText`),/AUD-C1/);await click('取消',`document.querySelector('.confirm-dialog')`);assert.ok(h.getPriceTables().some(t=>t.id===table.id));
  await click('删除');await click('确认删除',`document.querySelector('.confirm-dialog')`);await until(`!document.querySelector('.confirm-dialog')`);assert.equal(h.getPriceTables().some(t=>t.id===table.id),false);assert.equal(h.searchCustomers('AUD-C1')[0].priceTableId,h.getPriceTables().find(t=>t.isDefault).id);
 });
 await test('客户删除取消及确认',async()=>{
  await nav('/customer-manager');await until(`!!document.querySelector('.customer-card')`);await ev(`document.querySelector('.customer-card').click()`);await click('删除');await click('取消',`document.querySelector('.confirm-dialog')`);assert.equal(h.searchCustomers('AUD-C1').length,1);await click('删除');await click('确认',`document.querySelector('.confirm-dialog')`);await until(`!document.querySelector('.confirm-dialog')`);assert.equal(h.searchCustomers('AUD-C1').length,0);
 });
 await nav('/product-manager');await until(`!!document.querySelector('.price-table-chip')`);await chip('默认');
 const openBoundaryProduct=async(code,name)=>{await click('+ 添加新商品');await input('[aria-label="新增商品编码"]',code);await input('[aria-label="新增商品名称"]',name);};
 await test('新增商品空单价在弹窗提示且不写入',async()=>{
  await openBoundaryProduct('AUD-EMPTY-PRICE','空价验收商品');await input('[aria-label="新增商品单价"]','');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!!document.querySelector('.confirm-dialog [role="alert"]')`);assert.match(await ev(`document.querySelector('.confirm-dialog [role="alert"]').innerText`),/请输入有效的非负单价/);assert.equal(h.searchProducts('AUD-EMPTY-PRICE').length,0);await click('取消',`document.querySelector('.confirm-dialog')`);
 });
 await test('新增商品超上限单价在弹窗提示且不写入',async()=>{
  await openBoundaryProduct('AUD-HUGE-PRICE','超限价验收商品');await input('[aria-label="新增商品单价"]','100000000000000');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!!document.querySelector('.confirm-dialog [role="alert"]')`);assert.match(await ev(`document.querySelector('.confirm-dialog [role="alert"]').innerText`),/请输入有效的非负单价/);assert.equal(h.searchProducts('AUD-HUGE-PRICE').length,0);await click('取消',`document.querySelector('.confirm-dialog')`);
 });
 await test('新增商品允许零单价与可选规格留空，基础价和默认表一致',async()=>{
  await openBoundaryProduct('AUD-ZERO-PRICE','零价验收商品');await input('[aria-label="新增商品单价"]','0');await click('保存',`document.querySelector('.confirm-dialog')`);await until(`!document.querySelector('.confirm-dialog')`);assert.equal(h.searchProducts('AUD-ZERO-PRICE')[0].price,0);assert.equal(h.getPriceTableItems(h.getPriceTables().find(t=>t.isDefault).id).find(p=>p.productCode==='AUD-ZERO-PRICE').price,0);
 });
 fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify({artifact,reports},null,2));app.exit(reports.some(r=>r.status==='FAIL')?1:0);
}
setTimeout(()=>{console.error('TIMEOUT',artifact);app.exit(2)},60000);run().catch(e=>{console.error(e,artifact);app.exit(2)});
