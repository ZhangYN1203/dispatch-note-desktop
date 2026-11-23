import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase, automaticBackup, createBackup, restoreDatabase } from './database'
import { listInventory, putInventory, deleteInventory, migrateInventory, inventoryMigrated } from './inventory'
import { getPrintOptions } from './print-options'
import { getPrintConfiguration, savePrinterProfile } from './printer-config'
import { normalizePrintProfile } from './print-profile'
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  getOrderItems,
  createOrderItem,
  updateOrderItem,
  deleteOrderItem,
  generateDocumentNo,
  searchProducts,
  createProduct,
  deleteProduct,
  updateProduct,
  searchCustomers,
  getCustomerByCode,
  getCustomerPrices,
  initCustomerPrices,
  updateCustomerPrice,
  undoLastPriceChangeByCustomer,
  getPriceChangeLogsByCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomersByPriceTableId,
  addCustomerProduct,
  removeCustomerProduct,
  searchCustomerPrices,
  previewExcelImport,
  applyExcelImport,
  saveOrderWithItems,
  getPriceTables,
  createPriceTable,
  deletePriceTable,
  renamePriceTable,
  getPriceTableItems,
  updatePriceTableItem,
  addPriceTableProduct,
  removePriceTableProduct,
  undoLastPriceChange,
  getPriceChangeLogs,
  getOrderSummary,
  // ── New handlers ──
  getWorkshops,
  createWorkshop,
  updateWorkshop,
  deleteWorkshop,
  getRawMaterials,
  searchRawMaterials,
  createRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
  generateInboundNo,
  generateOutboundNo,
  generateProductInboundNo,
  createMaterialInbound,
  getMaterialInbounds,
  createMaterialOutbound,
  getMaterialOutbounds,
  createProductInbound,
  getProductInbounds,
  getInventoryLogs,
  getRawMaterialReport,
  getProductReport,
  // ── Print Settings ──
  getPrintSettings,
  setPrintSettings,
} from './handlers'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '商品装具调拨单打印工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

}

function registerIpcHandlers() {
  ipcMain.handle('db:saveOrderWithItems', (_event, data, items, id) => saveOrderWithItems(data, items, id))
  ipcMain.handle('inventory:status', () => inventoryMigrated())
  let startupBackedUp = false
  ipcMain.handle('inventory:migrate', (_event, stores) => {
    migrateInventory(stores)
    if (!startupBackedUp) { automaticBackup(); startupBackedUp = true }
  })
  ipcMain.handle('inventory:list', (_event, store) => listInventory(store))
  ipcMain.handle('inventory:put', (_event, store, data, insertOnly) => putInventory(store, data, insertOnly))
  ipcMain.handle('inventory:delete', (_event, store, id) => deleteInventory(store, id))
  ipcMain.handle('backup:create', async () => {
    if (!inventoryMigrated()) throw new Error('库存数据尚未迁移完成，请稍后重试')
    const { dialog } = require('electron')
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `订单完整备份-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: '数据库备份', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return null
    createBackup(result.filePath)
    return result.filePath
  })
  ipcMain.handle('backup:restore', async () => {
    if (!inventoryMigrated()) throw new Error('库存数据尚未迁移完成，请稍后重试')
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: '数据库备份', extensions: ['db'] }], properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return false
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'warning', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0,
      message: '恢复将覆盖当前全部订单、客户、商品和生产库存数据。',
      detail: '系统会先备份当前数据。恢复完成后重新加载界面。是否继续？',
    })
    if (answer.response !== 1) return false
    restoreDatabase(result.filePaths[0])
    return true
  })
  // Order handlers
  ipcMain.handle('db:getOrders', async (_event, filters?: { search?: string }) => {
    return getOrders(filters)
  })

  ipcMain.handle('db:getOrderById', async (_event, id: number) => {
    return getOrderById(id)
  })

  ipcMain.handle('db:createOrder', async (_event, data: any) => {
    return createOrder(data)
  })

  ipcMain.handle('db:updateOrder', async (_event, id: number, data: any) => {
    return updateOrder(id, data)
  })

  ipcMain.handle('db:deleteOrder', async (_event, id: number) => {
    return deleteOrder(id)
  })

  // Order items handlers
  ipcMain.handle('db:getOrderItems', async (_event, orderId: number) => {
    return getOrderItems(orderId)
  })

  ipcMain.handle('db:createOrderItem', async (_event, data: any) => {
    return createOrderItem(data)
  })

  ipcMain.handle('db:updateOrderItem', async (_event, id: number, data: any) => {
    return updateOrderItem(id, data)
  })

  ipcMain.handle('db:deleteOrderItem', async (_event, id: number) => {
    return deleteOrderItem(id)
  })

  // Document number generation
  ipcMain.handle('db:generateDocumentNo', async (_event, date?: string) => {
    return generateDocumentNo(date)
  })

  ipcMain.handle('printing:getConfiguration', () => getPrintConfiguration())
  ipcMain.handle('printing:saveProfile', (_event, profile) => savePrinterProfile(profile))
  ipcMain.handle('printing:listPrinters', async () => {
    if (!mainWindow) throw new Error('打印窗口不可用')
    return (await mainWindow.webContents.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault }))
  })
  let printInProgress = false
  ipcMain.handle('print:window', async (_event, input) => {
    if (!mainWindow) throw new Error('打印窗口不可用')
    if (printInProgress) throw new Error('已有打印任务正在处理')
    const profile = normalizePrintProfile(input ?? getPrintConfiguration().active)
    const options = getPrintOptions(profile)
    printInProgress = true
    try {
      if (profile.printerName && !(await mainWindow.webContents.getPrintersAsync()).some(p => p.name === profile.printerName)) {
        throw new Error('选择的打印机已不可用，请重新打开打印设置选择打印机')
      }
      await new Promise<void>((resolve, reject) => {
        mainWindow!.webContents.print(options, (success, reason) => {
          if (success || /cancel/i.test(reason)) resolve()
          else reject(new Error(reason || '打印失败，请检查纸张规格和打印机驱动设置'))
        })
      })
    } finally { printInProgress = false }
  })

  // Products & Customers
  ipcMain.handle('db:searchProducts', async (_event, keyword?: string) => {
    return searchProducts(keyword)
  })

  ipcMain.handle('db:createProduct', async (_event, data: any) => {
    return createProduct(data)
  })

  ipcMain.handle('db:deleteProduct', async (_event, id: number) => {
    return deleteProduct(id)
  })

  ipcMain.handle('db:updateProduct', async (_event, id: number, data: any) => {
    return updateProduct(id, data)
  })

  ipcMain.handle('db:searchCustomers', async (_event, keyword?: string) => {
    return searchCustomers(keyword)
  })

  ipcMain.handle('db:getCustomerByCode', async (_event, code: string) => {
    return getCustomerByCode(code)
  })

  // Customer Prices (legacy aliases for OrderEdit compatibility)
  ipcMain.handle('db:getCustomerPrices', async (_event, customerCode: string) => {
    return getCustomerPrices(customerCode)
  })

  ipcMain.handle('db:initCustomerPrices', async (_event, customerCode: string) => {
    return initCustomerPrices(customerCode)
  })

  ipcMain.handle('db:updateCustomerPrice', async (_event, customerCode: string, productCode: string, newPrice: number) => {
    return updateCustomerPrice(customerCode, productCode, newPrice)
  })

  ipcMain.handle('db:undoLastPriceChange', async (_event, customerCode: string) => {
    return undoLastPriceChangeByCustomer(customerCode)
  })

  ipcMain.handle('db:getPriceChangeLogs', async (_event, customerCode: string) => {
    return getPriceChangeLogsByCustomer(customerCode)
  })

  // Customer Management
  ipcMain.handle('db:createCustomer', async (_event, data: any) => {
    return createCustomer(data)
  })

  ipcMain.handle('db:updateCustomer', async (_event, id: number, data: any) => {
    return updateCustomer(id, data)
  })

  ipcMain.handle('db:deleteCustomer', async (_event, id: number) => {
    return deleteCustomer(id)
  })

  ipcMain.handle('db:getCustomerById', async (_event, id: number) => {
    return getCustomerById(id)
  })

  ipcMain.handle('db:getCustomersByPriceTableId', async (_event, priceTableId: number) => {
    return getCustomersByPriceTableId(priceTableId)
  })

  // Customer Products (legacy aliases)
  ipcMain.handle('db:addCustomerProduct', async (_event, customerCode: string, productCode: string) => {
    return addCustomerProduct(customerCode, productCode)
  })

  ipcMain.handle('db:removeCustomerProduct', async (_event, customerCode: string, productCode: string) => {
    return removeCustomerProduct(customerCode, productCode)
  })

  ipcMain.handle('db:searchCustomerPrices', async (_event, customerCode: string, keyword?: string) => {
    return searchCustomerPrices(customerCode, keyword)
  })

  // Price Tables
  ipcMain.handle('db:getPriceTables', async () => {
    return getPriceTables()
  })

  ipcMain.handle('db:createPriceTable', async (_event, name: string) => {
    return createPriceTable(name)
  })

  ipcMain.handle('db:deletePriceTable', async (_event, id: number) => {
    return deletePriceTable(id)
  })

  ipcMain.handle('db:renamePriceTable', async (_event, id: number, name: string) => {
    return renamePriceTable(id, name)
  })

  ipcMain.handle('db:getPriceTableItems', async (_event, priceTableId: number) => {
    return getPriceTableItems(priceTableId)
  })

  ipcMain.handle('db:updatePriceTableItem', async (_event, priceTableId: number, productCode: string, newPrice: number) => {
    return updatePriceTableItem(priceTableId, productCode, newPrice)
  })

  ipcMain.handle('db:addPriceTableProduct', async (_event, priceTableId: number, productCode: string) => {
    return addPriceTableProduct(priceTableId, productCode)
  })

  ipcMain.handle('db:removePriceTableProduct', async (_event, priceTableId: number, productCode: string) => {
    return removePriceTableProduct(priceTableId, productCode)
  })

  ipcMain.handle('db:undoPriceTableChange', async (_event, priceTableId: number) => {
    return undoLastPriceChange(priceTableId)
  })

  ipcMain.handle('db:getPriceTableLogs', async (_event, priceTableId: number) => {
    return getPriceChangeLogs(priceTableId)
  })

  // Import Excel
  ipcMain.handle('db:importExcelData', async () => {
    if (!inventoryMigrated()) return { success: false, message: '库存数据迁移尚未完成，请稍后导入' }
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }], properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { success: false, message: '已取消选择文件' }
    try {
      // Keep the validated plan in the main process; the file cannot change between preview and commit.
      const plan = previewExcelImport(result.filePaths[0])
      const answer = await dialog.showMessageBox(mainWindow!, {
        type: 'question', buttons: ['取消', '确认导入'], defaultId: 0, cancelId: 0,
        message: '导入预览', detail: plan.summary + '\n导入前会自动备份，任一写入失败将整批回滚。',
      })
      if (answer.response !== 1) return { success: false, message: '已取消导入' }
      return applyExcelImport(plan)
    } catch (error: any) { return { success: false, message: `导入失败：${error.message}` } }
  })

  // Order Summary
  ipcMain.handle('db:getOrderSummary', async (_event, dateFrom: string, dateTo: string) => {
    return getOrderSummary(dateFrom, dateTo)
  })

  // Save file dialog
  ipcMain.handle('dialog:saveFile', async (_event, options: { defaultName: string; buffer: number[] }) => {
    const { dialog } = require('electron')
    const result = await dialog.showSaveDialog({
      defaultPath: options.defaultName,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, Buffer.from(options.buffer))
    return true
  })

  // ── Workshop handlers ──
  ipcMain.handle('db:getWorkshops', async () => getWorkshops())
  ipcMain.handle('db:createWorkshop', async (_event, data: any) => createWorkshop(data))
  ipcMain.handle('db:updateWorkshop', async (_event, id: number, data: any) => updateWorkshop(id, data))
  ipcMain.handle('db:deleteWorkshop', async (_event, id: number) => deleteWorkshop(id))

  // ── Raw Material handlers ──
  ipcMain.handle('db:getRawMaterials', async () => getRawMaterials())
  ipcMain.handle('db:searchRawMaterials', async (_event, keyword?: string) => searchRawMaterials(keyword))
  ipcMain.handle('db:createRawMaterial', async (_event, data: any) => createRawMaterial(data))
  ipcMain.handle('db:updateRawMaterial', async (_event, id: number, data: any) => updateRawMaterial(id, data))
  ipcMain.handle('db:deleteRawMaterial', async (_event, id: number) => deleteRawMaterial(id))

  // ── Material Inbound handlers ──
  ipcMain.handle('db:generateInboundNo', async (_event, date?: string) => generateInboundNo(date))
  ipcMain.handle('db:createMaterialInbound', async (_event, data: any) => createMaterialInbound(data))
  ipcMain.handle('db:getMaterialInbounds', async (_event, filters?: any) => getMaterialInbounds(filters))

  // ── Material Outbound handlers ──
  ipcMain.handle('db:generateOutboundNo', async (_event, date?: string) => generateOutboundNo(date))
  ipcMain.handle('db:createMaterialOutbound', async (_event, data: any) => createMaterialOutbound(data))
  ipcMain.handle('db:getMaterialOutbounds', async (_event, filters?: any) => getMaterialOutbounds(filters))

  // ── Product Inbound handlers ──
  ipcMain.handle('db:generateProductInboundNo', async (_event, date?: string) => generateProductInboundNo(date))
  ipcMain.handle('db:createProductInbound', async (_event, data: any) => createProductInbound(data))
  ipcMain.handle('db:getProductInbounds', async (_event, filters?: any) => getProductInbounds(filters))

  // ── Inventory Log handlers ──
  ipcMain.handle('db:getInventoryLogs', async (_event, filters?: any) => getInventoryLogs(filters))

  // ── Warehouse Report handlers ──
  ipcMain.handle('db:getRawMaterialReport', async (_event, dateFrom: string, dateTo: string) => getRawMaterialReport(dateFrom, dateTo))
  ipcMain.handle('db:getProductReport', async (_event, dateFrom: string, dateTo: string) => getProductReport(dateFrom, dateTo))

  // ── Settings handlers ──
  ipcMain.handle('settings:get', async () => getPrintSettings())
  ipcMain.handle('settings:set', async (_event, data: Record<string, string | number>) => {
    if ('printPageHeight' in data) savePrinterProfile(normalizePrintProfile({ ...getPrintConfiguration().active, preset: 'custom', heightMm: Number(data.printPageHeight) }))
    return setPrintSettings(data)
  })
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'orders.db')
  await initDatabase(dbPath)
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch(error => {
  require('electron').dialog.showErrorBox('启动失败', String(error))
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
