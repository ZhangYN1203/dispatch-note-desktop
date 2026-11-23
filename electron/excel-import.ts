import * as XLSX from 'xlsx'
import { queryOne, queryAll, run, withTransaction, automaticBackup } from './database'
import { inventoryMigrated } from './inventory'

type Row = Record<string, any>
export interface ExcelImportPlan { products: Row[]; customers: Row[]; summary: string }

export function previewExcelImport(file: string): ExcelImportPlan {
  const workbook = XLSX.readFile(file)
  const products: Row[] = [], customers: Row[] = [], errors: string[] = []
  const codes = { product: new Set<string>(), customer: new Set<string>() }
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheet], { header: 1, defval: '' })
    let kind: 'product' | 'customer' | undefined
    let header: string[] = []
    rows.forEach((cells, index) => {
      const values = cells.map(c => String(c ?? '').trim())
      if (values.includes('产品编码') || values.includes('productCode')) { kind = 'product'; header = values; return }
      if (values.includes('客户编码') || (values.includes('code') && values.includes('name'))) { kind = 'customer'; header = values; return }
      if (!kind || !values.some(Boolean)) return
      const get = (...names: string[]) => {
        const col = names.map(n => header.indexOf(n)).find(i => i >= 0)
        return col === undefined ? '' : values[col] || ''
      }
      const optional = (...names: string[]) => names.some(n => header.includes(n)) ? get(...names) : undefined
      const code = kind === 'product' ? get('产品编码', 'productCode') : get('客户编码', 'code')
      const name = kind === 'product' ? get('产品名称', 'productName') : get('客户名称', 'name')
      const label = `${sheet} 第 ${index + 1} 行`
      if (!code || !name) { errors.push(`${label}：编码和名称不能为空`); return }
      if (codes[kind].has(code)) { errors.push(`${label}：编码 ${code} 重复`); return }
      codes[kind].add(code)
      if (kind === 'product') {
        const rawPrice = optional('单价（元/件）', '单价', 'price')
        const price = rawPrice === undefined ? undefined : Number(rawPrice || 0)
        if (price !== undefined && (!Number.isFinite(price) || price < 0)) { errors.push(`${label}：价格必须是非负数`); return }
        products.push({ productCode: code, productName: name, price, brand: optional('品牌', 'brand'),
          specification: optional('规格', 'specification'), packageSpec: optional('整箱规格', 'packageSpec'), unit: optional('单位', 'unit') })
      } else {
        customers.push({ code, name, address: optional('收货地址', 'address'), contact: optional('联系人', 'contact'), phone: optional('电话', 'phone') })
      }
    })
  }
  if (errors.length) throw new Error(errors.slice(0, 20).join('\n'))
  if (!products.length && !customers.length) throw new Error('未识别到有效数据，请检查产品编码/客户编码及名称标题行')
  const updatedProducts = products.filter(p => queryOne('SELECT * FROM products WHERE productCode = ?', [p.productCode])).length
  const updatedCustomers = customers.filter(c => queryOne('SELECT * FROM customers WHERE code = ?', [c.code])).length
  return { products, customers, summary: `商品：新增 ${products.length - updatedProducts} 条，更新 ${updatedProducts} 条；客户：新增 ${customers.length - updatedCustomers} 条，更新 ${updatedCustomers} 条。\n按编码合并，不删除原记录，保留客户价格表及专属定价。` }
}

export function applyExcelImport(plan: ExcelImportPlan) {
  if (!inventoryMigrated()) throw new Error('库存数据迁移尚未完成，请稍后导入')
  const backup = automaticBackup('before-import')
  withTransaction(() => {
    for (const p of plan.products) {
      const old = queryAll('SELECT * FROM products WHERE productCode = ?', [p.productCode])
      if (old.length > 1) throw new Error(`现有商品编码 ${p.productCode} 重复，请先整理`)
      if (old.length) {
        run('UPDATE products SET brand=?,productName=?,specification=?,packageSpec=?,unit=?,price=? WHERE id=?',
          [p.brand ?? old[0].brand, p.productName, p.specification ?? old[0].specification, p.packageSpec ?? old[0].packageSpec, p.unit ?? old[0].unit, p.price ?? old[0].price, old[0].id])
      } else {
        run('INSERT INTO products (brand,productCode,productName,specification,packageSpec,unit,price) VALUES (?,?,?,?,?,?,?)',
          [p.brand ?? '', p.productCode, p.productName, p.specification ?? '', p.packageSpec ?? '', p.unit ?? '件', p.price ?? 0])
      }
      for (const table of queryAll('SELECT id FROM price_tables')) {
        run('INSERT OR IGNORE INTO price_table_items (priceTableId,productCode,price) VALUES (?,?,?)', [table.id, p.productCode, p.price ?? old[0]?.price ?? 0])
      }
    }
    const defaultId = queryOne('SELECT id FROM price_tables WHERE isDefault=1')?.id || 0
    for (const c of plan.customers) {
      const old = queryAll('SELECT * FROM customers WHERE code = ?', [c.code])
      if (old.length > 1) throw new Error(`现有客户编码 ${c.code} 重复，请先整理`)
      if (old.length) {
        run('UPDATE customers SET name=?,address=?,contact=?,phone=? WHERE id=?', [c.name, c.address ?? old[0].address, c.contact ?? old[0].contact, c.phone ?? old[0].phone, old[0].id])
      } else {
        run('INSERT INTO customers (code,name,address,contact,phone,priceTableId) VALUES (?,?,?,?,?,?)',
          [c.code, c.name, c.address ?? '', c.contact ?? '', c.phone ?? '', defaultId])
      }
    }
  })
  return { success: true, message: `导入成功：商品 ${plan.products.length} 条，客户 ${plan.customers.length} 条。导入前备份：${backup}` }
}

export function importExcelFromFile(file: string): { success: boolean; message: string } {
  try { return applyExcelImport(previewExcelImport(file)) }
  catch (error: any) { return { success: false, message: `导入失败：${error.message}` } }
}
