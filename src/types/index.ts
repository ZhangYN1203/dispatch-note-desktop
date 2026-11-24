import type { OrderStatus } from '../../electron/order-status'
import type { PrintProfile, PrintConfiguration, LocalPrinter, PrintFavorite } from '../../electron/print-profile'

export interface Order {
  status: OrderStatus
  id: number
  documentNo: string
  orderNo: string
  date: string
  sender: string
  senderPhone: string
  receiver: string
  receiverContact: string
  receiverPhone: string
  receiverAddress: string
  carrierVehicle: string
  carrierName: string
  warehouse: string
  outTime: string
  tonnage: string
  mileage: string
  maker: string
  reviewer: string
  remark: string
  createdAt: string
  updatedAt: string
  itemCount?: number
  items?: OrderItem[]
}

export interface OrderItem {
  id: number
  orderId: number
  productCode: string
  productName: string
  specification: string
  unit: string
  quantity: number
  price: number
  amount: number
  remark: string
  sortOrder: number
  packageSpec?: string
}

export interface Product {
  id: number
  brand: string
  productCode: string
  productName: string
  specification: string
  packageSpec: string
  unit: string
  price: number
}

export interface Customer {
  id: number
  code: string
  name: string
  address: string
  contact: string
  phone: string
  remark: string
  priceTableId: number
  priceTableName?: string
}

export interface CustomerPrice {
  customerCode?: string
  priceTableId: number
  productCode: string
  price: number
  productName?: string
  specification?: string
  unit?: string
  brand?: string
  packageSpec?: string
}

export interface PriceTable {
  id: number
  name: string
  isDefault: number
  createdAt: string
  updatedAt: string
}

export interface PriceChangeLog {
  id: number
  priceTableId: number
  productCode: string
  oldPrice: number
  newPrice: number
  changedAt: string
}

export interface ElectronAPI {
  inventoryOperation: (kind: string, data: Record<string, unknown>, requestId: string) => Promise<Record<string, unknown>>
  transitionOrder: (id: number, target: OrderStatus, options?: { reason?: string; returnStock?: boolean; allocations?: { itemId: number; stockId: number }[] }) => Promise<{ success: boolean; status: OrderStatus }>
  getOrderEvents: (id: number) => Promise<{ fromStatus: string; toStatus: string; reason: string; createdAt: string }[]>
  getInventoryArchiveSummary: () => Promise<{ table: string; count: number }[]>
  savePrintFavorite: (name: string, profile: PrintProfile) => Promise<PrintFavorite>
  deletePrintFavorite: (id: string) => Promise<void>
  getOrderDefaults: () => Promise<Partial<Pick<Order, 'sender' | 'senderPhone' | 'warehouse' | 'maker'>>>
  saveOrderDefaults: (data: Partial<Pick<Order, 'sender' | 'senderPhone' | 'warehouse' | 'maker'>>) => Promise<void>
  saveOrderWithItems: (data: Partial<Order>, items: Partial<OrderItem>[], id?: number) => Promise<{ id: number }>
  inventoryMigrated: () => Promise<boolean>
  migrateInventory: (stores: Record<string, any[]>) => Promise<void>
  listInventory: (store: string) => Promise<Record<string, any>[]>
  putInventory: (store: string, data: Record<string, any>, insertOnly?: boolean) => Promise<number>
  deleteInventory: (store: string, id: number) => Promise<void>
  createBackup: () => Promise<string | null>
  restoreBackup: () => Promise<boolean>
  generateDocumentNo: (date?: string) => Promise<string>
  getOrders: (filters?: { search?: string }) => Promise<(Order & { itemCount?: number; totalQuantity?: number })[]>
  getOrderById: (id: number) => Promise<(Order & { items: OrderItem[] }) | null>
  createOrder: (data: Partial<Order>) => Promise<{ id: number }>
  updateOrder: (id: number, data: Partial<Order>) => Promise<{ success: boolean }>
  deleteOrder: (id: number) => Promise<{ success: boolean }>
  getOrderItems: (orderId: number) => Promise<OrderItem[]>
  createOrderItem: (data: Partial<OrderItem>) => Promise<{ id: number }>
  updateOrderItem: (id: number, data: Partial<OrderItem>) => Promise<{ success: boolean }>
  deleteOrderItem: (id: number) => Promise<{ success: boolean }>
  printWindow: (profile?: PrintProfile) => Promise<void>
  getPrintConfiguration: () => Promise<PrintConfiguration>
  savePrinterProfile: (profile: PrintProfile) => Promise<PrintProfile>
  listPrinters: () => Promise<LocalPrinter[]>

  // Products & Customers
  searchProducts: (keyword?: string) => Promise<Product[]>
  getAllProducts: () => Promise<Product[]>
  createProduct: (data: { brand?: string; productCode: string; productName: string; specification?: string; packageSpec?: string; unit?: string; price?: number }) => Promise<{ id: number; error?: string }>,
  deleteProduct: (id: number) => Promise<{ success: boolean; message?: string }>,
  updateProduct: (id: number, data: { brand?: string; productCode?: string; productName?: string; specification?: string; packageSpec?: string; unit?: string; price?: number }) => Promise<{ success: boolean; message?: string }>,
  searchCustomers: (keyword?: string) => Promise<Customer[]>
  getCustomerByCode: (code: string) => Promise<Customer | null>
  importExcelData: () => Promise<{ success: boolean; message: string }>

  // Customer Prices (legacy)
  getCustomerPrices: (customerCode: string) => Promise<CustomerPrice[]>
  updateCustomerPrice: (customerCode: string, productCode: string, newPrice: number) => Promise<{ success: boolean }>
  undoLastPriceChange: (customerCode: string) => Promise<{ success: boolean; log?: PriceChangeLog; message?: string }>
  initCustomerPrices: (customerCode: string) => Promise<{ success: boolean }>
  getPriceChangeLogs: (customerCode: string) => Promise<PriceChangeLog[]>

  // Customer Management
  createCustomer: (data: { code: string; name: string; address: string; contact?: string; phone?: string; remark?: string; priceTableId?: number }) => Promise<{ id: number }>
  updateCustomer: (id: number, data: Partial<Customer>) => Promise<{ success: boolean }>
  deleteCustomer: (id: number) => Promise<{ success: boolean }>
  getCustomerById: (id: number) => Promise<Customer | null>,
  getCustomersByPriceTableId: (priceTableId: number) => Promise<Customer[]>

  // Customer Products (legacy)
  addCustomerProduct: (customerCode: string, productCode: string) => Promise<{ success: boolean; message?: string }>
  removeCustomerProduct: (customerCode: string, productCode: string) => Promise<{ success: boolean }>
  searchCustomerPrices: (customerCode: string, keyword?: string) => Promise<CustomerPrice[]>

  // Price Tables (new)
  getPriceTables: () => Promise<PriceTable[]>
  createPriceTable: (name: string) => Promise<{ id: number }>
  deletePriceTable: (id: number) => Promise<{ success: boolean; message?: string }>
  renamePriceTable: (id: number, name: string) => Promise<{ success: boolean }>
  getPriceTableItems: (priceTableId: number) => Promise<CustomerPrice[]>
  updatePriceTableItem: (priceTableId: number, productCode: string, newPrice: number) => Promise<{ success: boolean }>
  addPriceTableProduct: (priceTableId: number, productCode: string) => Promise<{ success: boolean; message?: string }>
  removePriceTableProduct: (priceTableId: number, productCode: string) => Promise<{ success: boolean; message?: string }>
  undoPriceTableChange: (priceTableId: number) => Promise<{ success: boolean; log?: PriceChangeLog; message?: string }>
  getPriceTableLogs: (priceTableId: number) => Promise<PriceChangeLog[]>

  // Order Summary
  getOrderSummary: (dateFrom: string, dateTo: string, status?: string) => Promise<{ details: any[]; summary: any[] }>

  // Save file
  saveFile: (options: { defaultName: string; buffer: number[] }) => Promise<boolean>

  // Print Settings
  getPrintSettings: () => Promise<Record<string, string>>
  setPrintSettings: (data: Record<string, string | number>) => Promise<{ success: boolean }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    inventoryReady?: Promise<void>
  }
}
