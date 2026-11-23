const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');
const excluded = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release', 'artifacts', 'tmp', 'coverage']);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [path.relative(root, file).replaceAll('\\', '/')];
  });
}
let files;
try { files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
catch { files = walk(root); }
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['access-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/],
  ['mobile-number', /(?<![A-Za-z0-9])1[3-9]\d{9}(?![A-Za-z0-9])/],
  ['personal-path', /(?:[A-Z]:\\Users\\[^\\\s]+|\/(?:Users|home)\/[^/\s]+)/i],
];
const failures = [];
const scan = (file, text) => {
  for (const [name, pattern] of patterns) if (pattern.test(text)) failures.push(`${file}: ${name}`);
};
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) continue;
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.claude|\.codex)(?:\/|$)/.test(file) || /\.(?:db|sqlite3?|exe|pdf|zip)$/.test(file)) {
    failures.push(`${file}: runtime or private file`); continue;
  }
  if (file.endsWith('.xlsx')) {
    if (file !== 'examples/demo-import.xlsx') { failures.push(`${file}: unexpected spreadsheet`); continue; }
    const workbook = XLSX.readFile(path.join(root, file));
    for (const sheet of workbook.SheetNames) scan(file, JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 })));
  } else if (/\.(?:ts|tsx|js|cjs|json|md|yml|yaml|html|css|bat|svg|mmd)$/.test(file) || ['LICENSE', '.gitignore', '.gitattributes'].includes(file)) {
    scan(file, fs.readFileSync(path.join(root, file), 'utf8'));
  }
}
const seed = fs.readFileSync(path.join(root, 'electron/database.ts'), 'utf8');
if (!seed.includes('DEMO-P001') || !seed.includes('DEMO-C001')) failures.push('missing fictional seed fixtures');
for (const name of ['README.md', 'LICENSE', 'examples/demo-import.xlsx', 'docs/images/orders.png', 'docs/images/editor.png', 'docs/images/print.png', 'docs/images/prices.png']) {
  if (!fs.existsSync(path.join(root, name))) failures.push(`${name}: required public asset missing`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Public file checks passed (${files.length} files). Pattern checks supplement manual review; they are not a complete security audit.`);
