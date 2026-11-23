import type { WebContentsPrintOptions } from 'electron'
import { normalizePrintProfile } from './print-profile'
import type { PrintProfile } from './print-profile'

export function getPrintOptions(input: PrintProfile | Record<string, string>): WebContentsPrintOptions {
  const p = normalizePrintProfile('widthMm' in input ? input as PrintProfile : { heightMm: Number(input.printPageHeight || 95) })
  return {
    landscape: p.orientation === 'landscape',
    pageSize: { width: Math.round(p.widthMm * 1000), height: Math.round(p.heightMm * 1000) },
    // Content margins are already present in the page CSS, not applied twice.
    margins: { marginType: 'none' },
    scaleFactor: 100,
    copies: p.copies,
    duplexMode: 'simplex',
    ...(p.printerName ? { deviceName: p.printerName } : {}),
    printBackground: true,
    silent: false,
  }
}
