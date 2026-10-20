import { useEffect, useRef, useState } from 'react'
import { CHAPTERS } from './config'
import { scroll } from './store'

// An original street-circuit outline (not a real track). The lap traced on it is the page's scroll progress.
export const TRACK =
  'M60 192 L60 150 C60 138 52 132 42 128 L22 120 C12 116 8 108 10 98 L16 64 C18 52 26 46 36 44 L58 40 ' +
  'C68 38 72 30 70 20 L68 12 C67 6 72 2 78 4 L104 12 C112 15 114 22 112 30 L100 84 C98 94 102 100 110 104 ' +
  'C116 107 118 114 116 122 L104 178 C102 188 94 194 84 194 L66 196 C62 196 60 194 60 192 Z'

type Props = { onJump: (progress: number) => void }

export function CircuitNav({ onJump }: Props) {
  const trackRef = useRef<SVGPathElement>(null)
  const lapRef = useRef<SVGPathElement>(null)
  const carRef = useRef<SVGGElement>(null)
  const [turns, setTurns] = useState<{ x: number; y: number }[]>([])
  const [active, setActive] = useState(0)
  const pctRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const path = trackRef.current!
    const len = path.getTotalLength()
    setTurns(CHAPTERS.map((c) => path.getPointAtLength(Math.min(c.at, 0.985) * len)))
    let raf = 0
    let last = -1
    const tick = () => {
      const p = scroll.progress
      if (Math.abs(p - last) > 0.0005) {
        last = p
        const pt = path.getPointAtLength(p * len)
        carRef.current!.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
        lapRef.current!.style.strokeDashoffset = String(len * (1 - p))
        if (pctRef.current) pctRef.current.textContent = String(Math.round(p * 100)).padStart(3, '0')
        let idx = 0
        CHAPTERS.forEach((c, i) => { if (p >= c.at - 0.08) idx = i })
        setActive((a) => (a === idx ? a : idx))
      }
      raf = requestAnimationFrame(tick)
    }
    lapRef.current!.style.strokeDasharray = String(len)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <aside className="circuit" aria-label="Circuit navigation">
      <svg viewBox="0 0 120 200" role="list">
        <path ref={trackRef} className="track" d={TRACK} />
        <path ref={lapRef} className="lap" d={TRACK} />
        {turns.map((t, i) => (
          <g
            key={CHAPTERS[i].id}
            className={'turn' + (i === active ? ' on' : '')}
            role="listitem"
            tabIndex={0}
            aria-label={`Go to ${CHAPTERS[i].label}`}
            onClick={() => onJump(CHAPTERS[i].at)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(CHAPTERS[i].at) } }}
          >
            <circle cx={t.x} cy={t.y} r={3.2} />
            <text x={t.x - 8} y={t.y + 3} textAnchor="end">{`T${i + 1} ${CHAPTERS[i].label}`}</text>
            <circle className="hit" cx={t.x} cy={t.y} r={10} />
          </g>
        ))}
        <g ref={carRef}>
          <circle className="car-glow" r={6} />
          <circle className="car" r={2.4} />
        </g>
      </svg>
      <div className="readout mono">
        <span>Lap</span>
        <b ref={pctRef}>000</b>
      </div>
    </aside>
  )
}
