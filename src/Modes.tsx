import { useEffect, useRef } from 'react'
import { store, useStore } from './store'
import { SKY_LABEL, useWeather, weather, type WeatherMode } from './weather'

// The studio's modes, top left: the wind tunnel (W) with its live aero readout, and the weather, which follows
// the visitor's own (click to preview rain or dry).
export function Modes() {
  const tunnel = useStore((s) => s.tunnel)
  const entered = useStore((s) => s.entered)
  const wx = useWeather()
  const next: Record<WeatherMode, WeatherMode> = { live: 'rain', rain: 'dry', dry: 'live' }
  const wet = weather.wet() > 0.05
  const sky = wx.mode === 'live' ? SKY_LABEL[wx.sky] : wx.mode === 'rain' ? 'Rain' : 'Dry'

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable]')) return
      if (e.key === 'w' || e.key === 'W') store.set({ tunnel: !store.get().tunnel })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  return (
    <div className={'modes mono' + (entered ? '' : ' waiting')}>
      <button className={'mode' + (tunnel ? ' on' : '')} aria-pressed={tunnel} onClick={() => store.set({ tunnel: !tunnel })}>
        <i aria-hidden="true" />Wind tunnel<kbd>W</kbd>
      </button>
      {tunnel && <AeroReadout />}
      {wx.ready && (
        <button className={'mode wx' + (wet ? ' on wet' : '')} onClick={() => weather.setMode(next[wx.mode])}
          title="The studio follows the weather where you are. Click to preview rain or dry.">
          <i aria-hidden="true" />
          {wx.city && wx.mode === 'live' ? `${wx.city}${wx.temp != null ? ` ${Math.round(wx.temp)}°` : ''} · ` : ''}{sky}
          <kbd>{wx.mode}</kbd>
        </button>
      )}
    </div>
  )
}

/** Tunnel numbers, settling and breathing a little like a live balance readout. */
function AeroReadout() {
  const refs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const base = [250, 0.0, 28, 4.12, 1.17, 42.6]
    const fmt = [(v: number) => v.toFixed(0), (v: number) => v.toFixed(1), (v: number) => v.toFixed(0), (v: number) => v.toFixed(2), (v: number) => v.toFixed(2), (v: number) => v.toFixed(1)]
    const wob = [0.6, 0.05, 0.4, 0.02, 0.008, 0.15]
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      // spin-up: the numbers climb to the test point over the first second
      const k = Math.min(1, (t - start) / 1100)
      const e = 1 - Math.pow(1 - k, 3)
      base.forEach((b, i) => {
        const el = refs.current[i]
        if (el) el.textContent = fmt[i](b * (i === 1 ? 1 : e) + Math.sin(t / (700 + i * 230) + i) * wob[i] * e)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const row = (k: string, i: number, unit: string) => (
    <div><span>{k}</span><b ref={(el) => { refs.current[i] = el }}>0</b><em>{unit}</em></div>
  )
  return (
    <div className="aero" role="status">
      {row('Air', 0, 'km/h')}
      {row('Yaw', 1, '°')}
      {row('Ride', 2, 'mm')}
      {row('CL·A', 3, '')}
      {row('CD·A', 4, '')}
      {row('Bal', 5, '% F')}
    </div>
  )
}
