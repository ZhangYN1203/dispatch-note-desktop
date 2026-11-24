import { createContext, useContext } from 'react'

export const OrderSystemActivity = createContext(true)
export const useOrderSystemActive = () => useContext(OrderSystemActivity)
