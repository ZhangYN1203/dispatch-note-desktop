import React from 'react'
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom'
import OrderList from './pages/OrderList'
import OrderEdit from './pages/OrderEdit'
import OrderPrint from './pages/OrderPrint'
import ProductManager from './pages/ProductManager'
import CustomerManager from './pages/CustomerManager'
import OrderSummary from './pages/OrderSummary'

const App: React.FC = () => {
  return (
    <HashRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<OrderList />} />
        <Route path="/orders/new" element={<OrderEdit />} />
        <Route path="/orders/:id" element={<OrderEdit />} />
        <Route path="/orders/:id/print" element={<OrderPrint />} />
        <Route path="/product-manager" element={<ProductManager />} />
        <Route path="/customer-manager" element={<CustomerManager />} />
        <Route path="/order-summary" element={<OrderSummary />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
