const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('库存增删接口写入未结束时禁止切换，全部成功或失败后解除', async () => {
  const pending = [];
  const document = {
    readyState:'loading', addEventListener(){}, getElementById(){return null;}, querySelector(){return null;},
    createElement(){return {remove(){},style:{}};}, body:{appendChild(){}},
  };
  const window = {electronAPI:{
    inventoryMigrated:async()=>true, migrateInventory:async()=>{}, listInventory:async()=>[],
    deleteInventory:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
  }};
  const context = vm.createContext({window,document,confirm:()=>true,setTimeout:()=>0,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/new-modules.js'),'utf8'), context);
  await window.inventoryReady;
  window.__newModule.deleteMaterial(123);
  window.__newModule.deleteSupplier(456);
  assert.equal(window.__newModule.canSwitchSystem(),false,'pending CRUD writes must be guarded immediately');
  await new Promise(setImmediate);
  assert.equal(pending.length,2);
  pending[0].resolve(); await new Promise(setImmediate);
  assert.equal(window.__newModule.canSwitchSystem(),false,'another write is still pending');
  pending[1].reject(new Error('模拟保存失败')); await new Promise(setImmediate);
  assert.equal(window.__newModule.canSwitchSystem(),true,'failed write also releases its pending state');
});
