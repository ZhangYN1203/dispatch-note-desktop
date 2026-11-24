import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export default function OrderDialog({ title, children, onClose, busy = false, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    heading.current?.focus()
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="modal-overlay order-dialog-overlay no-print" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])
      const first = controls[0], last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === heading.current)) { event.preventDefault(); first.focus() }
    }
  }}><div ref={dialog} className={`modal-dialog order-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2>
    {children}
  </div></div>, document.body)
}
