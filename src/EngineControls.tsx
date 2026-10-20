import { useEffect, useRef, useState } from 'react'
import { BURNOUT_RPM, engine, LIMIT, onEngineChange, setRev, startEngine, stopEngine } from './engine'
import { useStore } from './store'
import { fx } from './fx'

export function EngineControls() {
  const [running, setRunning] = useState(engine.running)
  const [busy, setBusy] = useState(false)
  const dragged = useStore((s) => s.dragged)
  const revealed = useStore((s) => s.revealed)
  const rpmRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => onEngineChange(() => setRunning(engine.running)), [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (rpmRef.current) rpmRef.current.textContent = String(Math.round(engine.rpm / 10) * 10).padStart(5, '0')
      if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, engine.rpm / LIMIT)})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // hold Space to rev while the engine runs
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !engine.running || (e.target as HTMLElement)?.closest?.('input,textarea')) return
      e.preventDefault()
      if (!e.repeat) setRev(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setRev(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const start = async () => {
    setBusy(true)
    try { await startEngine() } finally { setBusy(false) }
  }

  return (
    <div className="engine mono">
      <div className={'drag-hint' + (dragged ? ' used' : '')} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 12a8 8 0 0 1 14.9-4M20 12a8 8 0 0 1-14.9 4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M19 3v5h-5M5 21v-5h5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        Drag the car · 360°
      </div>
      <div className="tach">
        <span>RPM</span>
        <b ref={rpmRef}>00000</b>
        <div className="tach-bar"><div ref={barRef} /></div>
      </div>
      <div className="engine-btns">
        {!running ? (
          <button className="btn-solid" onClick={start} disabled={busy}>
            {busy ? 'Priming…' : 'Start engine'}
          </button>
        ) : (
          <>
            <button
              className="btn-solid rev"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setRev(true) }}
              onPointerUp={() => setRev(false)}
              onPointerCancel={() => setRev(false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              Hold to rev
            </button>
            <button className="btn-line" onClick={stopEngine}>Kill</button>
          </>
        )}
      </div>
      {!revealed && (
        <button className="skip mono" onClick={() => { fx.requestReveal = true }}>
          No sound? Enter quietly →
        </button>
      )}
      <p className="engine-note">
        {revealed
          ? 'Driver revealed. Rev it again any time.'
          : running
            ? `Hold past ${BURNOUT_RPM.toLocaleString('en-US')} rpm. The lap opens once the driver is out of the smoke.`
            : 'Start it and burn out to reveal the driver and open the lap. Sound on.'}
      </p>
    </div>
  )
}
