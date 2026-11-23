import type { WebContentsPrintOptions } from 'electron'

export function getPrintOptions(settings: Record<string, string>): WebContentsPrintOptions {
  const height = Number(settings.printPageHeight || '95')
  if (!Number.isInteger(height) || height < 70 || height > 150) throw new Error('纸张高度必须是 70～150 mm 的整数')
  return {
    landscape: false,
    pageSize: { width: 240000, height: height * 1000 },
    margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
    printBackground: true,
    silent: false,
  }
}
