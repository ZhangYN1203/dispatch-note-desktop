import { queryOne, run, withTransaction } from './database'
import { DEFAULT_PRINT_PROFILE, normalizePrintProfile } from './print-profile'
import type { PrintProfile, PrintConfiguration } from './print-profile'

export function getPrintConfiguration(): PrintConfiguration {
  const active = queryOne("SELECT value FROM settings WHERE key='printProfileV2'")?.value
  const profiles = queryOne("SELECT value FROM settings WHERE key='printerProfilesV2'")?.value
  try {
    const stored: Record<string, PrintProfile> = Object.create(null)
    if (profiles) {
      for (const [key, value] of Object.entries(JSON.parse(profiles))) stored[key] = normalizePrintProfile(value as PrintProfile)
    }
    const legacy = Number(queryOne("SELECT value FROM settings WHERE key='printPageHeight'")?.value || 95)
    return { active: active ? normalizePrintProfile(JSON.parse(active)) : normalizePrintProfile({ heightMm: legacy }), profiles: stored }
  } catch {
    return { active: { ...DEFAULT_PRINT_PROFILE }, profiles: {}, warning: '保存的打印规格无法读取，已显示默认规格，请核对后重新保存。' }
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
