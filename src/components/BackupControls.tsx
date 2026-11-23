import { useRef, useState } from 'react'

export default function BackupControls() {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const run = async (action: 'backup' | 'restore' | 'import') => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    try {
      await window.inventoryReady
      if (action === 'import') {
        const result = await window.electronAPI.importExcelData()
        setMessage(result.message)
      } else if (action === 'restore') {
        if (await window.electronAPI.restoreBackup()) window.location.reload()
      } else {
        const file = await window.electronAPI.createBackup()
        if (file) setMessage(`完整备份已保存：${file}`)
      }
    } catch (error: unknown) {
      setMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <div className="card no-print" style={{ marginBottom: 16 }}>
    <div className="btn-group">
      <button className="btn" disabled={busy} onClick={() => run('backup')}>备份全部数据</button>
      <button className="btn" disabled={busy} onClick={() => run('restore')}>从备份恢复</button>
      <button className="btn" disabled={busy} onClick={() => run('import')}>导入商品与客户 Excel</button>
      <span style={{ alignSelf: 'center', color: '#666', fontSize: 13 }}>备份包含全部业务数据；导入前会预览并自动备份。</span>
    </div>
    {message && <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
  </div>
}
