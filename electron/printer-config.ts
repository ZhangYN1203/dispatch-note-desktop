import { randomUUID } from 'crypto'
import { queryOne, run, withTransaction } from './database'
import { DEFAULT_PRINT_PROFILE, normalizePrintProfile } from './print-profile'
import type { PrintProfile, PrintConfiguration, PrintFavorite } from './print-profile'

export function getPrintConfiguration(): PrintConfiguration {
  const active = queryOne("SELECT value FROM settings WHERE key='printProfileV2'")?.value
  const profiles = queryOne("SELECT value FROM settings WHERE key='printerProfilesV2'")?.value
  try {
    const stored: Record<string, PrintProfile> = Object.create(null)
    if (profiles) {
      for (const [key, value] of Object.entries(JSON.parse(profiles))) stored[key] = normalizePrintProfile(value as PrintProfile)
    }
    const legacy = Number(queryOne("SELECT value FROM settings WHERE key='printPageHeight'")?.value || 95)
    return { favorites: getFavorites(), active: active ? normalizePrintProfile(JSON.parse(active)) : normalizePrintProfile({ heightMm: legacy }), profiles: stored }
  } catch {
    return { favorites: [], active: { ...DEFAULT_PRINT_PROFILE }, profiles: {}, warning: '保存的打印规格无法读取，已显示默认规格，请核对后重新保存。' }
  }
}

export function savePrinterProfile(input: PrintProfile): PrintProfile {
  const profile = normalizePrintProfile(input)
  const config = getPrintConfiguration()
  const profiles = { ...config.profiles, [profile.printerName || 'default']: profile }
  withTransaction(() => {
    run("INSERT OR REPLACE INTO settings (key,value) VALUES ('printProfileV2',?)", [JSON.stringify(profile)])
    run("INSERT OR REPLACE INTO settings (key,value) VALUES ('printerProfilesV2',?)", [JSON.stringify(profiles)])
    run("INSERT OR REPLACE INTO settings (key,value) VALUES ('printPageHeight',?)", [String(profile.heightMm)])
  })
  return profile
}

function getFavorites(): PrintFavorite[] {
  const raw = queryOne("SELECT value FROM settings WHERE key='printFavoritesV1'")?.value
  if (!raw) return []
  const favorites = JSON.parse(raw)
  if (!Array.isArray(favorites)) throw new Error('收藏格式错误')
  return favorites.map(item => ({ id: String(item.id), name: String(item.name), profile: normalizePrintProfile(item.profile) }))
}
export function savePrintFavorite(name: string, input: PrintProfile): PrintFavorite {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new Error('方案名称须为 1～60 字')
  const profile = normalizePrintProfile(input)
  const favorites = getFavorites()
  const old = favorites.find(item => item.name === name.trim() && item.profile.printerName === profile.printerName)
  if (!old && favorites.length >= 100) throw new Error('最多保存 100 个收藏，请先删除不用的方案')
  const favorite = { id: old?.id || randomUUID(), name: name.trim(), profile }
  const updated = [...favorites.filter(item => item.id !== favorite.id), favorite]
  run("INSERT OR REPLACE INTO settings (key,value) VALUES ('printFavoritesV1',?)", [JSON.stringify(updated)])
  return favorite
}
export function deletePrintFavorite(id: string): void {
  const favorites = getFavorites()
  if (!favorites.some(item => item.id === id)) throw new Error('收藏不存在')
  run("INSERT OR REPLACE INTO settings (key,value) VALUES ('printFavoritesV1',?)", [JSON.stringify(favorites.filter(item => item.id !== id))])
}
