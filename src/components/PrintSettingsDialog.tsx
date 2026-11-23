import { useEffect, useRef, useState } from 'react'
import { getDriverGuidance, getPrintErrorMessage, getPageGeometry, getPresetProfile, normalizePrintProfile } from '../../electron/print-profile'
import type { LocalPrinter, PaperPreset, PrintConfiguration, PrintProfile } from '../../electron/print-profile'

interface Props {
  profile: PrintProfile
  config: PrintConfiguration
  printRequested: boolean
  busy: boolean
  onApply: (profile: PrintProfile, print: boolean) => Promise<void>
  onClose: () => void
}

export default function PrintSettingsDialog({ profile, config, printRequested, busy, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(profile)
  const [printers, setPrinters] = useState<LocalPrinter[]>([])
  const [printerWarning, setPrinterWarning] = useState('')
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement
    heading.current?.focus()
    let active = true
    window.electronAPI.listPrinters().then(items => {
      if (!active) return
      setPrinters(items)
      if (!items.length) setPrinterWarning('未检测到打印机。请在系统中安装或连接打印机；仍可调整规格并查看预览。')
    }).catch(error => { if (active) setPrinterWarning('无法读取打印机列表：' + getPrintErrorMessage(error)) })
    return () => { active = false; restoreFocus.current?.focus() }
  }, [])
  const change = (field: keyof PrintProfile, value: string | number) => {
    setError('')
    setDraft(previous => ({ ...previous, [field]: value,
      ...(['widthMm', 'heightMm'].includes(field) ? { preset: 'custom' as const } : {}) }))
  }
  const choosePrinter = (name: string) => {
    setDraft(config.profiles[name || 'default'] ?? { ...draft, printerName: name })
    setError('')
  }
  let valid: PrintProfile | null = null
  let validation = ''
  try { valid = normalizePrintProfile(draft) } catch (error) { validation = (error as Error).message }
  const geometry = valid && getPageGeometry(valid)
  const numberField = (label: string, field: keyof PrintProfile, min: number, max: number, step = 1) => (
    <label className="print-setting-field">{label}
      <input aria-label={label} type="number" min={min} max={max} step={step}
        value={Number.isFinite(draft[field]) ? Number(draft[field]) : ''}
        disabled={busy} onChange={event => change(field, event.target.value === '' ? NaN : Number(event.target.value))} />
    </label>
  )
  const submit = async (print: boolean) => {
    if (!valid || busy) return
    try { await onApply(valid, print) } catch (error) { setError(getPrintErrorMessage(error)) }
  }
  return <div className="print-settings-overlay no-print" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="print-settings-title" className="print-settings-dialog">
      <div className="print-settings-heading">
        <h2 ref={heading} tabIndex={-1} id="print-settings-title">{printRequested ? '打印前确认规格' : '打印规格设置'}</h2>
        <button type="button" aria-label="关闭打印设置" className="btn" disabled={busy} onClick={onClose}>关闭</button>
      </div>
      <p>选择纸张与打印机，应用后重新分页。每台打印机会分别记住最近使用的规格。</p>
      {printerWarning && <p className="print-setting-warning" role="status">{printerWarning}</p>}
      <div className="print-settings-grid">
        <label className="print-setting-field">打印机
          <select aria-label="打印机" value={draft.printerName} disabled={busy} onChange={event => choosePrinter(event.target.value)}>
            <option value="">系统默认打印机（在系统窗口中确认）</option>
            {draft.printerName && !printers.some(p => p.name === draft.printerName) && <option value={draft.printerName}>{draft.printerName}（系统列表中未找到）</option>}
            {printers.map(p => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? '（默认）' : ''}</option>)}
          </select>
        </label>
        <label className="print-setting-field">纸张规格
          <select aria-label="纸张规格" value={draft.preset} disabled={busy} onChange={event => { try { setDraft(getPresetProfile(event.target.value as PaperPreset, draft)); setError('') } catch (error) { setError(getPrintErrorMessage(error)) } }}>
            <option value="continuous">连续联单 240 × 95 mm</option>
            <option value="a4">A4 210 × 297 mm</option>
            <option value="a5">A5 148 × 210 mm</option>
            <option value="letter">Letter 215.9 × 279.4 mm</option>
            <option value="custom">自定义纸张</option>
          </select>
        </label>
        {numberField('纸张宽度（mm）', 'widthMm', 80, 420, 0.1)}
        {numberField('纸张高度（mm）', 'heightMm', 50, 600, 0.1)}
        <label className="print-setting-field">方向
          <select aria-label="方向" value={draft.orientation} disabled={busy} onChange={event => change('orientation', event.target.value)}>
            <option value="portrait">纵向（按输入宽高）</option><option value="landscape">横向（宽高互换）</option>
          </select>
        </label>
        {numberField('字号（磅）', 'fontSizePt', 6, 18, 0.5)}
        {numberField('上边距（mm）', 'marginTopMm', 0, 100, 0.5)}
        {numberField('下边距（mm）', 'marginBottomMm', 0, 100, 0.5)}
        {numberField('左边距（mm）', 'marginLeftMm', 0, 100, 0.5)}
        {numberField('右边距（mm）', 'marginRightMm', 0, 100, 0.5)}
        {numberField('每页最多商品行数', 'maxRowsPerPage', 1, 50)}
        {numberField('打印份数', 'copies', 1, 99)}
      </div>
      {geometry && <p className="print-setting-summary">页面 {geometry.widthMm} × {geometry.heightMm} mm；内容区域 {geometry.contentWidthMm} × {geometry.contentHeightMm} mm。实际每页行数会按内容自动减少。</p>}
      {valid && <section className="print-driver-guide" aria-label="本地打印机设置指引">
        <h3>请在本地打印设置中核对</h3>
        <ol>{getDriverGuidance(valid).map(line => <li key={line}>{line}</li>)}</ol>
        <p>软件不能保证驱动支持所有自定义纸型，也不会修改打印机的永久默认设置。如果在系统打印窗口更换纸型或方向，请取消并返回这里同步修改。</p>
      </section>}
      {(error || validation) && <p className="error-message" role="alert">{error || validation}</p>}
      <div className="print-settings-actions">
        <button className="btn" disabled={busy || !valid} onClick={() => void submit(false)}>应用并查看预览</button>
        {printRequested && <button className="btn btn-primary" disabled={busy || !valid} onClick={() => void submit(true)}>{busy ? '正在准备…' : '确认规格，进入系统打印'}</button>}
      </div>
    </div>
  </div>
}
