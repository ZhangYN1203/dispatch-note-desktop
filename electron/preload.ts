import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  saveOrderWithItems: (data: any, items: any[], id?: number) => ipcRenderer.invoke('db:saveOrderWithItems', data, items, id),
  inventoryMigrated: () => ipcRenderer.invoke('inventory:status'),
  migrateInventory: (stores: Record<string, any[]>) => ipcRenderer.invoke('inventory:migrate', stores),
  listInventory: (store: string) => ipcRenderer.invoke('inventory:list', store),
  putInventory: (store: string, data: any, insertOnly = false) => ipcRenderer.invoke('inventory:put', store, data, insertOnly),
  deleteInventory: (store: string, id: number) => ipcRenderer.invoke('inventory:delete', store, id),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  getPrintConfiguration: () => ipcRenderer.invoke('printing:getConfiguration'),
  savePrinterProfile: (profile: unknown) => ipcRenderer.invoke('printing:saveProfile', profile),
  listPrinters: () => ipcRenderer.invoke('printing:listPrinters'),
  // Customer Management
  createCustomer: (data: any) => ipcRenderer.invoke('db:createCustomer', data),
  updateCustomer: (id: number, data: any) => ipcRenderer.invoke('db:updateCustomer', id, data),
  deleteCustomer: (id: number) => ipcRenderer.invoke('db:deleteCustomer', id),
  getCustomerById: (id: number) => ipcRenderer.invoke('db:getCustomerById', id),
  getCustomersByPriceTableId: (priceTableId: number) => ipcRenderer.invoke('db:getCustomersByPriceTableId', priceTableId),

  // Customer Products (legacy)
  addCustomerProduct: (customerCode: string, productCode: string) => ipcRenderer.invoke('db:addCustomerProduct', customerCode, productCode),
  removeCustomerProduct: (customerCode: string, productCode: string) => ipcRenderer.invoke('db:removeCustomerProduct', customerCode, productCode),
  searchCustomerPrices: (customerCode: string, keyword?: string) => ipcRenderer.invoke('db:searchCustomerPrices', customerCode, keyword),

  // Orders
  generateDocumentNo: (date?: string) => ipcRenderer.invoke('db:generateDocumentNo', date),
  getOrders: (filters?: { search?: string }) => ipcRenderer.invoke('db:getOrders', filters),
  getOrderById: (id: number) => ipcRenderer.invoke('db:getOrderById', id),
  createOrder: (data: any) => ipcRenderer.invoke('db:createOrder', data),
  updateOrder: (id: number, data: any) => ipcRenderer.invoke('db:updateOrder', id, data),
  deleteOrder: (id: number) => ipcRenderer.invoke('db:deleteOrder', id),

  // Order Items
  getOrderItems: (orderId: number) => ipcRenderer.invoke('db:getOrderItems', orderId),
  createOrderItem: (data: any) => ipcRenderer.invoke('db:createOrderItem', data),
  updateOrderItem: (id: number, data: any) => ipcRenderer.invoke('db:updateOrderItem', id, data),
  deleteOrderItem: (id: number) => ipcRenderer.invoke('db:deleteOrderItem', id),

  // Print
  printWindow: (profile?: unknown) => ipcRenderer.invoke('print:window', profile),

  // Products & Customers
  searchProducts: (keyword?: string) => ipcRenderer.invoke('db:searchProducts', keyword),
  getAllProducts: () => ipcRenderer.invoke('db:searchProducts'),
  createProduct: (data: any) => ipcRenderer.invoke('db:createProduct', data),
  deleteProduct: (id: number) => ipcRenderer.invoke('db:deleteProduct', id),
  updateProduct: (id: number, data: any) => ipcRenderer.invoke('db:updateProduct', id, data),
  searchCustomers: (keyword?: string) => ipcRenderer.invoke('db:searchCustomers', keyword),
  getCustomerByCode: (code: string) => ipcRenderer.invoke('db:getCustomerByCode', code),
  importExcelData: () => ipcRenderer.invoke('db:importExcelData'),

  // Customer Prices (legacy)
  getCustomerPrices: (customerCode: string) => ipcRenderer.invoke('db:getCustomerPrices', customerCode),
  initCustomerPrices: (customerCode: string) => ipcRenderer.invoke('db:initCustomerPrices', customerCode),
  updateCustomerPrice: (customerCode: string, productCode: string, newPrice: number) => ipcRenderer.invoke('db:updateCustomerPrice', customerCode, productCode, newPrice),
  undoLastPriceChange: (customerCode: string) => ipcRenderer.invoke('db:undoLastPriceChange', customerCode),
  getPriceChangeLogs: (customerCode: string) => ipcRenderer.invoke('db:getPriceChangeLogs', customerCode),

  // Price Tables (new)
  getPriceTables: () => ipcRenderer.invoke('db:getPriceTables'),
  createPriceTable: (name: string) => ipcRenderer.invoke('db:createPriceTable', name),
  deletePriceTable: (id: number) => ipcRenderer.invoke('db:deletePriceTable', id),
  renamePriceTable: (id: number, name: string) => ipcRenderer.invoke('db:renamePriceTable', id, name),
  getPriceTableItems: (priceTableId: number) => ipcRenderer.invoke('db:getPriceTableItems', priceTableId),
  updatePriceTableItem: (priceTableId: number, productCode: string, newPrice: number) => ipcRenderer.invoke('db:updatePriceTableItem', priceTableId, productCode, newPrice),
  addPriceTableProduct: (priceTableId: number, productCode: string) => ipcRenderer.invoke('db:addPriceTableProduct', priceTableId, productCode),
  removePriceTableProduct: (priceTableId: number, productCode: string) => ipcRenderer.invoke('db:removePriceTableProduct', priceTableId, productCode),
  undoPriceTableChange: (priceTableId: number) => ipcRenderer.invoke('db:undoPriceTableChange', priceTableId),
  getPriceTableLogs: (priceTableId: number) => ipcRenderer.invoke('db:getPriceTableLogs', priceTableId),

  // Order Summary
  getOrderSummary: (dateFrom: string, dateTo: string) => ipcRenderer.invoke('db:getOrderSummary', dateFrom, dateTo),

  // Save file dialog
  saveFile: (options: { defaultName: string; buffer: number[] }) => ipcRenderer.invoke('dialog:saveFile', options),

  // ── Workshop ──
  getWorkshops: () => ipcRenderer.invoke('db:getWorkshops'),
  createWorkshop: (data: any) => ipcRenderer.invoke('db:createWorkshop', data),
  updateWorkshop: (id: number, data: any) => ipcRenderer.invoke('db:updateWorkshop', id, data),
  deleteWorkshop: (id: number) => ipcRenderer.invoke('db:deleteWorkshop', id),

  // ── Raw Materials ──
  getRawMaterials: () => ipcRenderer.invoke('db:getRawMaterials'),
  searchRawMaterials: (keyword?: string) => ipcRenderer.invoke('db:searchRawMaterials', keyword),
  createRawMaterial: (data: any) => ipcRenderer.invoke('db:createRawMaterial', data),
  updateRawMaterial: (id: number, data: any) => ipcRenderer.invoke('db:updateRawMaterial', id, data),
  deleteRawMaterial: (id: number) => ipcRenderer.invoke('db:deleteRawMaterial', id),

  // ── Material Inbound ──
  generateInboundNo: (date?: string) => ipcRenderer.invoke('db:generateInboundNo', date),
  createMaterialInbound: (data: any) => ipcRenderer.invoke('db:createMaterialInbound', data),
  getMaterialInbounds: (filters?: any) => ipcRenderer.invoke('db:getMaterialInbounds', filters),

  // ── Material Outbound ──
  generateOutboundNo: (date?: string) => ipcRenderer.invoke('db:generateOutboundNo', date),
  createMaterialOutbound: (data: any) => ipcRenderer.invoke('db:createMaterialOutbound', data),
  getMaterialOutbounds: (filters?: any) => ipcRenderer.invoke('db:getMaterialOutbounds', filters),

  // ── Product Inbound ──
  generateProductInboundNo: (date?: string) => ipcRenderer.invoke('db:generateProductInboundNo', date),
  createProductInbound: (data: any) => ipcRenderer.invoke('db:createProductInbound', data),
  getProductInbounds: (filters?: any) => ipcRenderer.invoke('db:getProductInbounds', filters),

  // ── Inventory Log ──
  getInventoryLogs: (filters?: any) => ipcRenderer.invoke('db:getInventoryLogs', filters),

  // ── Warehouse Report ──
  getRawMaterialReport: (dateFrom: string, dateTo: string) => ipcRenderer.invoke('db:getRawMaterialReport', dateFrom, dateTo),
  getProductReport: (dateFrom: string, dateTo: string) => ipcRenderer.invoke('db:getProductReport', dateFrom, dateTo),

  // ── Settings ──
  getPrintSettings: () => ipcRenderer.invoke('settings:get'),
  setPrintSettings: (data: Record<string, string | number>) => ipcRenderer.invoke('settings:set', data),
})
