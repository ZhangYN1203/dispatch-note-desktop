import { getPageGeometry } from '../../electron/print-profile'
import type { PrintProfile } from '../../electron/print-profile'

export default function CalibrationSheet({ profile }: { profile: PrintProfile }) {
  const page = getPageGeometry(profile)
  const width = page.contentWidthMm
  const height = page.contentHeightMm - 1
  return <div className="calibration-sheet">
    <svg width="100%" height={`${height}mm`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="十毫米校准标尺">
      <text x="2" y="5" fontSize="4">打印规格校准页</text>
      <text x="2" y="10" fontSize="2.5">纸张 {page.widthMm} × {page.heightMm} mm · 100% · 每格 10 mm</text>
      <rect x=".5" y="13" width={width - 1} height={height - 20} fill="none" stroke="black" strokeWidth=".25" />
      {Array.from({ length: Math.floor((width - 8) / 10) }, (_, index) => <g key={index}>
        <path d={`M${(index + 1) * 10},13v3`} stroke="black" strokeWidth=".2" />
        <text x={(index + 1) * 10} y="20" fontSize="2.5" textAnchor="middle">{(index + 1) * 10}</text>
      </g>)}
      {height > 40 && <><rect x="10" y="25" width="10" height="10" fill="none" stroke="black" strokeWidth=".25" /><text x="25" y="32" fontSize="3">10 × 10 mm</text></>}
      <text x="2" y={height - 2} fontSize="2.4">用尺核对刻度；截边请加大边距，尺寸不符请核对缩放。</text>
    </svg>
  </div>
}
