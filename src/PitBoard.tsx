import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from './store'

/** The pit board: each livery change is a stop, timed live and held up for a moment, broadcast style. */
export function PitBoard() {
  const at = useStore((s) => s.pitAt)
  const time = useStore((s) => s.pitTime)
  return (
    <div className="pitboard-slot" aria-live="polite">
      <AnimatePresence>
        {at > 0 && <Board key={at} at={at} time={time} />}
      </AnimatePresence>
    </div>
  )
}

function Board({ at, time }: { at: number; time: number }) {
  const ref = useRef<HTMLElement>(null)
  const done = useRef(false)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = Math.min(time, (performance.now() - at) / 1000)
      if (ref.current) ref.current.textContent = t.toFixed(2) + 's'
      if (t >= time && !done.current) { done.current = true; host.current?.classList.add('final') }
      // hold the final time a moment, then take the board down
      if ((performance.now() - at) / 1000 > time + 1.8) { host.current?.classList.add('gone'); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [at, time])
  return (
    <motion.div ref={host} className="pitboard mono"
      initial={{ opacity: 0, x: 40, skewX: -10 }} animate={{ opacity: 1, x: 0, skewX: 0 }} exit={{ opacity: 0, x: 40 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
      <span className="pb-k">Pit stop</span>
      <b ref={ref}>0.00s</b>
      <span className="pb-sub">Livery change</span>
    </motion.div>
  )
}
