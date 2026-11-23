const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, file);

test('自定义纸张与横向的有效页面和内容尺寸一致', () => {
  const { normalizePrintProfile, getPageGeometry } = require('../electron/print-profile.ts');
  const profile = normalizePrintProfile({ widthMm: 210, heightMm: 297, orientation: 'landscape',
    marginTopMm: 5, marginBottomMm: 7, marginLeftMm: 10, marginRightMm: 12 });
  assert.deepEqual(getPageGeometry(profile), { widthMm: 297, heightMm: 210, contentWidthMm: 275, contentHeightMm: 198 });
});

test('拒绝无效纸张、页边距、字号和份数，允许连续纸以外的高度', () => {
  const { normalizePrintProfile } = require('../electron/print-profile.ts');
  assert.equal(normalizePrintProfile({ heightMm: 297 }).heightMm, 297);
  for (const invalid of [{ widthMm: NaN }, { heightMm: Infinity }, { widthMm: 0 }, { marginLeftMm: -1 },
    { marginTopMm: 90, marginBottomMm: 90 }, { fontSizePt: 0 }, { copies: 0 }, { copies: 1.5 },
    { orientation: 'invalid' }, { maxRowsPerPage: 0 }]) assert.throws(() => normalizePrintProfile(invalid));
});

test('预设纸张与自定义规格，保留选择的打印机', () => {
  const { getPresetProfile, normalizePrintProfile } = require('../electron/print-profile.ts');
  const a4 = getPresetProfile('a4', normalizePrintProfile({ printerName: 'Office Printer' }));
  assert.equal(a4.widthMm, 210); assert.equal(a4.heightMm, 297);
  assert.equal(a4.printerName, 'Office Printer');
  assert.equal(getPresetProfile('continuous', a4).heightMm, 95);
});

test('打印选项与 CSS 同一规格：边距由页面保留，不重复增加，缩放为100%', () => {
  const { getPrintOptions } = require('../electron/print-options.ts');
  const { normalizePrintProfile } = require('../electron/print-profile.ts');
  const options = getPrintOptions(normalizePrintProfile({ widthMm: 210, heightMm: 297, orientation: 'landscape', printerName: 'Office Printer', copies: 2 }));
  assert.deepEqual(options.pageSize, { width: 210000, height: 297000 });
  assert.equal(options.landscape, true); assert.equal(options.scaleFactor, 100);
  assert.equal(options.margins.marginType, 'none'); assert.equal(options.deviceName, 'Office Printer');
  assert.equal(options.copies, 2); assert.equal(options.silent, false);
});

test('本地设置提示随纸型、方向和内容边距变化', () => {
  const { normalizePrintProfile, getDriverGuidance } = require('../electron/print-profile.ts');
  const guide = getDriverGuidance(normalizePrintProfile({ widthMm: 216, heightMm: 140, orientation: 'landscape', marginLeftMm: 8 })).join('\n');
  assert.match(guide, /216.*140/); assert.match(guide, /横向/);
  assert.match(guide, /100%/); assert.match(guide, /8/);
});

test('打印失败提示只显示用户能处理的原因', () => {
  const { getPrintErrorMessage } = require('../electron/print-profile.ts');
  assert.equal(typeof getPrintErrorMessage, 'function');
  assert.equal(getPrintErrorMessage(new Error("Error invoking remote method 'print:window': Error: 打印机未连接")), '打印机未连接');
});
