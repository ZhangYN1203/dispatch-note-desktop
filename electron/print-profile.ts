// Pure paper/layout contract shared by the main process and React. No Electron or Node imports.
export type PaperPreset = 'continuous' | 'a4' | 'a5' | 'letter' | 'custom'
export interface PrintProfile {
  preset: PaperPreset
  printerName: string
  widthMm: number
  heightMm: number
  orientation: 'portrait' | 'landscape'
  marginTopMm: number
  marginBottomMm: number
  marginLeftMm: number
  marginRightMm: number
  fontSizePt: number
  maxRowsPerPage: number
  copies: number
}
export interface LocalPrinter { name: string; displayName: string; isDefault: boolean }
export interface PrintFavorite { id: string; name: string; profile: PrintProfile }
export interface PrintConfiguration { favorites: PrintFavorite[]; active: PrintProfile; profiles: Record<string, PrintProfile>; warning?: string }

export function getPrintErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '打印操作失败，请检查打印机和纸张设置'
}

export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  preset: 'continuous', printerName: '', widthMm: 240, heightMm: 95, orientation: 'portrait',
  marginTopMm: 2, marginBottomMm: 2, marginLeftMm: 2, marginRightMm: 2,
  fontSizePt: 11, maxRowsPerPage: 10, copies: 1,
}

export function getPageGeometry(profile: PrintProfile) {
  const widthMm = profile.orientation === 'landscape' ? profile.heightMm : profile.widthMm
  const heightMm = profile.orientation === 'landscape' ? profile.widthMm : profile.heightMm
  return { widthMm, heightMm, contentWidthMm: widthMm - profile.marginLeftMm - profile.marginRightMm,
    contentHeightMm: heightMm - profile.marginTopMm - profile.marginBottomMm }
}

export function normalizePrintProfile(input: Partial<PrintProfile>): PrintProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('打印规格格式错误')
  const p = { ...DEFAULT_PRINT_PROFILE, ...input }
  if (!['continuous', 'a4', 'a5', 'letter', 'custom'].includes(p.preset)) throw new Error('纸张类型无效')
  if (!['portrait', 'landscape'].includes(p.orientation)) throw new Error('纸张方向无效')
  if (typeof p.printerName !== 'string' || p.printerName.length > 512) throw new Error('打印机名称无效')
  const ranges: [keyof PrintProfile, number, number, string][] = [
    ['widthMm', 80, 420, '纸张宽度须为 80～420 mm'], ['heightMm', 50, 600, '纸张高度须为 50～600 mm'],
    ['marginTopMm', 0, 100, '上边距须为 0～100 mm'], ['marginBottomMm', 0, 100, '下边距须为 0～100 mm'],
    ['marginLeftMm', 0, 100, '左边距须为 0～100 mm'], ['marginRightMm', 0, 100, '右边距须为 0～100 mm'],
    ['fontSizePt', 6, 18, '字号须为 6～18 磅'], ['maxRowsPerPage', 1, 50, '每页最多行数须为 1～50'],
    ['copies', 1, 99, '份数须为 1～99'],
  ]
  for (const [key, min, max, message] of ranges) {
    const value = p[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(message)
  }
  if (!Number.isInteger(p.copies) || !Number.isInteger(p.maxRowsPerPage)) throw new Error('份数和每页最多行数必须是整数')
  const geometry = getPageGeometry(p)
  if (geometry.contentWidthMm < 60 || geometry.contentHeightMm < 30) throw new Error('边距过大，至少保留 60 mm 宽、30 mm 高的内容区域')
  // Return only known fields, even when called through IPC with extra properties.
  return Object.fromEntries(Object.keys(DEFAULT_PRINT_PROFILE).map(key => [key, p[key as keyof PrintProfile]])) as unknown as PrintProfile
}

export function getPresetProfile(preset: PaperPreset, current: PrintProfile): PrintProfile {
  if (preset === 'custom') return { ...current, preset }
  const paper = { continuous: [240, 95, 2, 10], a4: [210, 297, 10, 50],
    a5: [148, 210, 8, 30], letter: [215.9, 279.4, 10, 50] }[preset]
  if (!paper) throw new Error('纸张类型无效')
  return normalizePrintProfile({ ...current, preset, widthMm: paper[0], heightMm: paper[1], orientation: 'portrait',
    marginTopMm: paper[2], marginBottomMm: paper[2], marginLeftMm: paper[2], marginRightMm: paper[2], maxRowsPerPage: paper[3] })
}

export function getDriverGuidance(profile: PrintProfile): string[] {
  const p = normalizePrintProfile(profile)
  const name = { continuous: '自定义连续纸', a4: 'A4', a5: 'A5', letter: 'Letter', custom: '自定义纸张' }[p.preset]
  return [
    `打印机：${p.printerName || '系统默认打印机'}。系统打印窗口中请核对是否为同一台。`,
    `纸张大小：${name}，宽 ${p.widthMm} × 高 ${p.heightMm} mm。驱动没有该尺寸时，先在打印首选项中创建同尺寸自定义纸型。`,
    `方向：${p.orientation === 'landscape' ? '横向（页面宽高互换）' : '纵向（按输入宽高）'}。`,
    '缩放：100% / 实际大小；若驱动提供“适合纸张”“自动缩小”，请关闭。每张纸 1 页，关闭额外页眉页脚。',
    `软件内容边距：上 ${p.marginTopMm}、下 ${p.marginBottomMm}、左 ${p.marginLeftMm}、右 ${p.marginRightMm} mm；系统边距选“无”（若可选），避免重复叠加。`,
    `份数：${p.copies}。先试打 1 张；驱动不可打印区域、进纸偏移和撕边位置以实际设备为准，再调整软件边距。`,
  ]
}
