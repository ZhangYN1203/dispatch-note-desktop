// Prepare an empty, independently identified distribution without changing development seeds.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const stage = path.join(root,'release',`independent-source-${sourcePackage.version}-${stamp}`);
fs.mkdirSync(stage,{recursive:true});
for (const name of ['src','electron','public','index.html','vite.config.ts','tsconfig.json','tsconfig.electron.json','package.json','package-lock.json','LICENSE']) {
  fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true});
}
const databaseFile = path.join(stage,'electron/database.ts');
let database = fs.readFileSync(databaseFile,'utf8');
const begin = database.indexOf('function seedDefaultData(');
const end = database.indexOf('function exportDb(',begin);
if(begin<0 || end<0) throw new Error('Cannot locate initialization boundary');
database = database.slice(0,begin)+'function seedDefaultData(_defaultTableId: number): void { /* Independent installs start empty. */ }\n\n'+database.slice(end);
fs.writeFileSync(databaseFile,database);
const editorFile = path.join(stage,'src/pages/OrderEdit.tsx');
const editor = fs.readFileSync(editorFile,'utf8');
if(!editor.includes("sender: '示例发货单位（虚构）'")) throw new Error('Unexpected sender fixture; inspect before distribution');
fs.writeFileSync(editorFile,editor.replace("sender: '示例发货单位（虚构）'","sender: ''"));
const pkg = JSON.parse(JSON.stringify(sourcePackage));
pkg.name='business-workbench';
pkg.description='订单与发货、生产与库存本地业务工作台';
pkg.build.appId='io.github.zhangyn1203.business-workbench';
pkg.build.productName='本地业务工作台';
pkg.build.nsis.shortcutName='本地业务工作台';
pkg.build.directories.output=path.join(root,'release',`independent-v${pkg.version}`);
fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const lock=JSON.parse(fs.readFileSync(path.join(stage,'package-lock.json'),'utf8'));
lock.name=pkg.name;lock.packages[''].name=pkg.name;
fs.writeFileSync(path.join(stage,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
fs.symlinkSync(path.join(root,'node_modules'),path.join(stage,'node_modules'),'junction');
fs.writeFileSync(path.join(root,'release','independent-stage-path.txt'),stage);
console.log(JSON.stringify({stage,output:pkg.build.directories.output,version:pkg.version}));
