// The wind tunnel's particles, simulated off the main thread (airflow.ts). The page asks for a step with the
// time that has passed; the worker advances every particle and sends back copies of their state to draw.
import { fillAir, loadAirField, makeAir, stepAir, type Air, type Field } from './airflow'

let F: Field | null = null
let A: Air | null = null

type In = { type: 'init'; url: string; n: number } | { type: 'step'; dt: number }

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  if (m.type === 'init') {
    F = await loadAirField(m.url)
    A = makeAir(m.n)
    fillAir(A, F)
    // let the air settle round the car before it is first seen
    for (let i = 0; i < 40; i++) stepAir(A, F, 1 / 30)
    self.postMessage({ type: 'ready' })
    return
  }
  if (m.type === 'step' && A && F) {
    stepAir(A, F, Math.min(m.dt, 1 / 30))
    const pos = A.pos.slice(), vel = A.vel.slice(), data = A.data.slice()
    ;(self as unknown as Worker).postMessage({ type: 'frame', pos, vel, data }, [pos.buffer, vel.buffer, data.buffer])
  }
}
