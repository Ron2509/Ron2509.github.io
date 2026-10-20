import { useEffect, useRef } from 'react'

const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], .circuit, .top, .card'

/** Spring-follow cursor: a dot that tracks exactly and a ring that trails with mass and damping. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches) return
    document.documentElement.classList.add('has-cursor')
    const s = { x: innerWidth / 2, y: innerHeight / 2, vx: 0, vy: 0, tx: innerWidth / 2, ty: innerHeight / 2, scale: 1, ts: 1 }
    let mode = ''
    const root = document.documentElement
    const move = (e: PointerEvent) => {
      // nothing is drawn until the pointer is actually over the page
      if (!root.classList.contains('cursor-live')) { s.x = e.clientX; s.y = e.clientY; root.classList.add('cursor-live') }
      s.tx = e.clientX
      s.ty = e.clientY
      const t = e.target as HTMLElement
      const next = document.body.classList.contains('grabbing') ? 'drag' : t.closest(INTERACTIVE) ? 'link' : 'stage'
      if (next !== mode) {
        mode = next
        ring.current?.setAttribute('data-mode', mode)
        if (label.current) label.current.textContent = mode === 'stage' ? 'Drag' : mode === 'drag' ? '360°' : ''
        s.ts = mode === 'link' ? 0.45 : mode === 'drag' ? 1.25 : 1
      }
    }
    const down = () => { if (mode !== 'link') { mode = 'drag'; ring.current?.setAttribute('data-mode', 'drag'); if (label.current) label.current.textContent = '360°'; s.ts = 1.25 } }
    const up = () => { mode = ''; }
    const leave = () => root.classList.remove('cursor-live')
    root.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      // spring: stiffness 220, damping 22, mass 1
      const k = 220, c = 22
      s.vx += (k * (s.tx - s.x) - c * s.vx) * dt
      s.vy += (k * (s.ty - s.y) - c * s.vy) * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.scale += (s.ts - s.scale) * Math.min(1, dt * 12)
      if (ring.current) ring.current.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -50%) scale(${s.scale})`
      if (dot.current) dot.current.style.transform = `translate3d(${s.tx}px, ${s.ty}px, 0) translate(-50%, -50%)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      document.documentElement.classList.remove('has-cursor', 'cursor-live')
    }
  }, [])

  return (
    <>
      <div className="cursor-ring" ref={ring} aria-hidden="true"><span ref={label} className="mono">Drag</span></div>
      <div className="cursor-dot" ref={dot} aria-hidden="true" />
    </>
  )
}
