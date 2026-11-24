import React from 'react'
import { Route, Navigate, createHashRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom'
import OrderList from './pages/OrderList'
import OrderEdit from './pages/OrderEdit'
import OrderPrint from './pages/OrderPrint'
import ProductManager from './pages/ProductManager'
import CustomerManager from './pages/CustomerManager'
import OrderSummary from './pages/OrderSummary'

const router = createHashRouter(createRoutesFromElements(<>
  <Route path="/" element={<OrderList />} />
  <Route path="/orders/new" element={<OrderEdit />} />
  <Route path="/orders/:id" element={<OrderEdit />} />
  <Route path="/orders/:id/print" element={<OrderPrint />} />
  <Route path="/product-manager" element={<ProductManager />} />
  <Route path="/customer-manager" element={<CustomerManager />} />
  <Route path="/order-summary" element={<OrderSummary />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</>), { future: { v7_relativeSplatPath: true } })
const App: React.FC = () => <RouterProvider router={router} future={{ v7_startTransition: true }} />
export default App
