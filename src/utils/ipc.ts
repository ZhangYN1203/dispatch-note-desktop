/**
 * IPC utility functions for the renderer process.
 * These functions call the Electron IPC bridge exposed via preload.
 */

import type { Order, OrderItem, Customer, CustomerPrice, PriceTable, PriceChangeLog, Product } from '../types'

function getApi() {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available. Are you running inside Electron?')
  }
  return window.electronAPI
}

// ── Orders ──

export async function generateDocumentNo(date?: string): Promise<string> {
  const api = getApi()
  return api.generateDocumentNo(date)
}

export async function fetchOrders(search?: string): Promise<(Order & { itemCount?: number })[]> {
  const api = getApi()
  return api.getOrders(search ? { search } : undefined)
}

export async function fetchOrderById(id: number): Promise<(Order & { items: OrderItem[] }) | null> {
  const api = getApi()
  return api.getOrderById(id)
}

export async function saveOrder(data: Partial<Order>): Promise<{ id: number }> {
  const api = getApi()
  return api.createOrder(data)
}

export async function editOrder(id: number, data: Partial<Order>): Promise<void> {
  const api = getApi()
  await api.updateOrder(id, data)
}

export async function removeOrder(id: number): Promise<void> {
  const api = getApi()
  await api.deleteOrder(id)
}

// ── Order Items ──

export async function fetchOrderItems(orderId: number): Promise<OrderItem[]> {
  const api = getApi()
  return api.getOrderItems(orderId)
}

export async function saveOrderItem(data: Partial<OrderItem>): Promise<{ id: number }> {
  const api = getApi()
  return api.createOrderItem(data)
}

export async function editOrderItem(id: number, data: Partial<OrderItem>): Promise<void> {
  const api = getApi()
  await api.updateOrderItem(id, data)
}

export async function removeOrderItem(id: number): Promise<void> {
  const api = getApi()
  await api.deleteOrderItem(id)
}

// ── Print ──

export async function printWindow(): Promise<void> {
  const api = getApi()
  return api.printWindow()
}

// ── Products & Customers ──

export async function searchProducts(keyword?: string): Promise<any[]> {
  const api = getApi()
  return api.searchProducts(keyword)
}

export async function getAllProducts(): Promise<any[]> {
  const api = getApi()
  return api.getAllProducts()
}

export async function searchCustomers(keyword?: string): Promise<Customer[]> {
  const api = getApi()
  return api.searchCustomers(keyword)
}

export async function createProduct(data: { brand?: string; productCode: string; productName: string; specification?: string; packageSpec?: string; unit?: string; price?: number }): Promise<{ id: number; error?: string }> {
  const api = getApi()
  return api.createProduct(data)
}

export async function deleteProduct(id: number): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.deleteProduct(id)
}

export async function updateProduct(id: number, data: { brand?: string; productCode?: string; productName?: string; specification?: string; packageSpec?: string; unit?: string; price?: number }): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.updateProduct(id, data)
}

export async function getCustomerByCode(code: string): Promise<Customer | null> {
  const api = getApi()
  return api.getCustomerByCode(code)
}

export async function importExcelData(): Promise<{ success: boolean; message: string }> {
  const api = getApi()
  return api.importExcelData()
}

// ── Customer Prices (legacy) ──

export async function getCustomerPrices(customerCode: string): Promise<CustomerPrice[]> {
  const api = getApi()
  return api.getCustomerPrices(customerCode)
}

export async function initCustomerPrices(customerCode: string): Promise<{ success: boolean }> {
  const api = getApi()
  return api.initCustomerPrices(customerCode)
}

export async function updateCustomerPrice(customerCode: string, productCode: string, newPrice: number): Promise<{ success: boolean }> {
  const api = getApi()
  return api.updateCustomerPrice(customerCode, productCode, newPrice)
}

export async function undoLastPriceChange(customerCode: string): Promise<any> {
  const api = getApi()
  return api.undoLastPriceChange(customerCode)
}

export async function getPriceChangeLogs(customerCode: string): Promise<any[]> {
  const api = getApi()
  return api.getPriceChangeLogs(customerCode)
}

// ── Customer Management ──

export async function createCustomer(data: { code: string; name: string; address: string; contact?: string; phone?: string; remark?: string; priceTableId?: number }): Promise<{ id: number }> {
  const api = getApi()
  return api.createCustomer(data)
}

export async function updateCustomer(id: number, data: Partial<Customer>): Promise<{ success: boolean }> {
  const api = getApi()
  return api.updateCustomer(id, data)
}

export async function deleteCustomer(id: number): Promise<{ success: boolean }> {
  const api = getApi()
  return api.deleteCustomer(id)
}

export async function getCustomerById(id: number): Promise<Customer | null> {
  const api = getApi()
  return api.getCustomerById(id)
}

export async function getCustomersByPriceTableId(priceTableId: number): Promise<Customer[]> {
  const api = getApi()
  return api.getCustomersByPriceTableId(priceTableId)
}

// ── Customer Products (legacy) ──

export async function addCustomerProduct(customerCode: string, productCode: string): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.addCustomerProduct(customerCode, productCode)
}

export async function removeCustomerProduct(customerCode: string, productCode: string): Promise<{ success: boolean }> {
  const api = getApi()
  return api.removeCustomerProduct(customerCode, productCode)
}

export async function searchCustomerPrices(customerCode: string, keyword?: string): Promise<CustomerPrice[]> {
  const api = getApi()
  return api.searchCustomerPrices(customerCode, keyword)
}

// ── Price Tables (new) ──

export async function getPriceTables(): Promise<PriceTable[]> {
  const api = getApi()
  return api.getPriceTables()
}

export async function createPriceTable(name: string): Promise<{ id: number }> {
  const api = getApi()
  return api.createPriceTable(name)
}

export async function deletePriceTable(id: number): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.deletePriceTable(id)
}

export async function renamePriceTable(id: number, name: string): Promise<{ success: boolean }> {
  const api = getApi()
  return api.renamePriceTable(id, name)
}

export async function getPriceTableItems(priceTableId: number): Promise<CustomerPrice[]> {
  const api = getApi()
  return api.getPriceTableItems(priceTableId)
}

export async function updatePriceTableItem(priceTableId: number, productCode: string, newPrice: number): Promise<{ success: boolean }> {
  const api = getApi()
  return api.updatePriceTableItem(priceTableId, productCode, newPrice)
}

export async function addPriceTableProduct(priceTableId: number, productCode: string): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.addPriceTableProduct(priceTableId, productCode)
}

export async function removePriceTableProduct(priceTableId: number, productCode: string): Promise<{ success: boolean; message?: string }> {
  const api = getApi()
  return api.removePriceTableProduct(priceTableId, productCode)
}

export async function undoPriceTableChange(priceTableId: number): Promise<{ success: boolean; log?: PriceChangeLog; message?: string }> {
  const api = getApi()
  return api.undoPriceTableChange(priceTableId)
}

export async function getPriceTableLogs(priceTableId: number): Promise<PriceChangeLog[]> {
  const api = getApi()
  return api.getPriceTableLogs(priceTableId)
}

// ── Order Summary ──

export async function getOrderSummary(dateFrom: string, dateTo: string): Promise<{ details: any[]; summary: any[] }> {
  const api = getApi()
  return api.getOrderSummary(dateFrom, dateTo)
}

// ── Save File ──

export async function saveFile(options: { defaultName: string; buffer: number[] }): Promise<boolean> {
  const api = getApi()
  return api.saveFile(options)
}

// ── Print Settings ──

export async function getPrintSettings(): Promise<Record<string, string>> {
  const api = getApi()
  return api.getPrintSettings()
}

export async function setPrintSettings(data: Record<string, string | number>): Promise<{ success: boolean }> {
  const api = getApi()
  return api.setPrintSettings(data)
}
export async function saveOrderWithItems(data: Partial<Order>, items: Partial<OrderItem>[], id?: number) {
  return getApi().saveOrderWithItems(data, items, id)
}
