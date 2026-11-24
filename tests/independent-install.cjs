// Verify the independent package in a fresh temporary profile; never install into the user's profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-empty-install-'));
app.setPath('userData',profile);
const resources=process.env.ORDER_PRINT_PACKAGED_RESOURCES;
if(!resources)throw new Error('Set ORDER_PRINT_PACKAGED_RESOURCES');
process.resourcesPath=resources;
const appRoot=path.join(resources,'app.asar');
app.on('browser-window-created',(_,w)=>w.hide());
require(path.join(appRoot,'dist-electron/main.js'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 await app.whenReady();let window;
 for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoading())break;await wait(50);}
 assert.ok(window);const js=code=>window.webContents.executeJavaScript(code);
 const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await wait(50);}throw new Error('Timeout: '+code);};
 await until(`!!window.inventoryReady && !!document.querySelector('[data-system-choice="orders"]')`);await js('window.inventoryReady');
 const db=require(path.join(appRoot,'dist-electron/database.js'));
 for(const table of ['orders','customers','products','production_records'])assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM '+table).n,0,table+' starts empty');
 const pkg=require(path.join(appRoot,'package.json'));assert.equal(pkg.name,'business-workbench');assert.equal(app.getPath('userData'),profile);
 await js(`document.querySelector('[data-system-choice="orders"]').click()`);
 await until('document.body.innerText.includes("暂无订单")');
 await js('document.querySelector(".page-header .btn-primary").click()');
 await until(`!!document.querySelector('[aria-label="发货单位"]')`);
 assert.equal(await js(`document.querySelector('[aria-label="发货单位"]').value`),'');
 console.log(JSON.stringify({passed:['首次启动选择系统','订单、商品、客户和库存均为空','发货单位为空','独立应用标识'],profile}));app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('Independent install timeout');app.exit(1);},20000);
