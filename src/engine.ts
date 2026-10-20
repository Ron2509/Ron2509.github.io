
// Engine state shared by the audio graph and the 3D scene (smoke, wheel spin, body shake).
export const engine = {
  running: false,
  revving: false,
  rpm: 0,
  throttle: 0,
  /** 0..1, how hard the rear tyres are spinning */
  burnout: 0,
  /** short exhaust puff, decays to 0 */
  puff: 0,
}

const IDLE = 820
/** Big-block redline: where the limiter bounces it. */
export const LIMIT = 6900
/** Hold it past this and the rear tyres let go. */
export const BURNOUT_RPM = 5000

/** Synth level while it is on. */
const LEVEL = 0.55

let ctx: AudioContext | null = null
let node: AudioWorkletNode | null = null
let master: GainNode | null = null
let tone: BiquadFilterNode | null = null
let raf = 0
let startedAt = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function onEngineChange(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function impulse(ac: AudioContext, seconds: number) {
  const len = Math.floor(ac.sampleRate * seconds)
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  return buf
}

async function build() {
  ctx = new AudioContext({ latencyHint: 'interactive' })
  await ctx.audioWorklet.addModule('/v8-worklet.js')
  node = new AudioWorkletNode(ctx, 'v8-engine', { outputChannelCount: [2] })

  // exhaust chest, a little glue, then the garage
  const chest = ctx.createBiquadFilter()
  chest.type = 'lowshelf'; chest.frequency.value = 120; chest.gain.value = 4
  tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'; tone.frequency.value = 4000; tone.Q.value = 0.5
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.15
  const room = ctx.createConvolver()
  room.buffer = impulse(ctx, 1.2)
  const wet = ctx.createGain(); wet.gain.value = 0.14
  master = ctx.createGain(); master.gain.value = 0

  node.connect(chest).connect(tone).connect(glue)
  glue.connect(master)
  glue.connect(room).connect(wet).connect(master)
  master.connect(ctx.destination)
}

/** What the worklet is told each frame. */
export const voice = { rpm: 0, throttle: 0, cut: 0, load: 0, starter: 0, squeal: 0 }

let idleWander = 0
let cutUntil = 0

/** One control step: where the revs want to be and how fast they get there. `now` in ms. */
export function step(dt: number, now: number) {
  const since = (now - startedAt) / 1000

  // the big cam makes the idle hunt and lope
  idleWander += (Math.random() - 0.5) * dt * 700
  idleWander *= Math.exp(-dt * 1.4)
  let target = IDLE + idleWander + Math.sin(since * Math.PI * 2 * 1.6) * 40
  let thr = 0.05
  let load = 0
  let starter = 0
  const fall = 3200

  if (since < 1.1) {
    // starter cranks briefly, it catches, one big flare, then a fast idle that settles
    if (since < 0.6) { starter = 1; target = 200 + Math.sin(since * Math.PI * 2 * 4.5) * 45; thr = 0 }
    else if (since < 0.84) { target = 3200; thr = 0.9 }
    else { target = 1450; thr = 0.04 }
  } else if (engine.revving) {
    target = LIMIT + 300
    thr = 1
    // the tyres let go: the engine is loaded, the climb slows and hangs high
    load = engine.burnout * 0.6
  }

  // rev limiter: hard spark cut, the revs fall, ignition comes back -> BRAP-BRAP-BRAP
  if (engine.revving && engine.rpm >= LIMIT && now > cutUntil) cutUntil = now + 45 + Math.random() * 50
  const cutting = now < cutUntil
  if (cutting) { thr = 0; if (engine.revving) target = LIMIT - 900 }

  // a heavy flywheel: strong through the midrange, slower to spin up than a race engine, and slower again
  // with the tyres biting
  const free = (4200 + 5200 * Math.sin(Math.min(1, engine.rpm / LIMIT) * Math.PI * 0.9)) * (1 - 0.45 * load)
  const rate = target > engine.rpm ? free : cutting && engine.revving ? 22000 : fall
  engine.rpm += Math.sign(target - engine.rpm) * Math.min(Math.abs(target - engine.rpm), rate * dt)
  engine.throttle += (thr - engine.throttle) * Math.min(1, dt * (cutting ? 60 : 14))
  engine.burnout += ((engine.revving && engine.rpm > BURNOUT_RPM ? 1 : 0) - engine.burnout) * Math.min(1, dt * (engine.revving ? 2 : 1.1))
  engine.puff = Math.max(0, engine.puff - dt * 1.4)

  voice.rpm = engine.rpm
  voice.throttle = engine.throttle
  voice.cut = cutting ? 1 : 0
  voice.load = load
  voice.starter = starter
  voice.squeal = engine.burnout
  return voice
}

/** The lowpass on the whole engine: the note opens up as revs climb. */
export function toneHz(v: typeof voice) {
  return 3200 + Math.min(1, v.rpm / LIMIT) * 5200
}

let lastT = 0
/** When the synth last went quiet (ms): the revs keep winding down under the fade for a moment. */
let quietAt = 0
let level = -1
function loop() {
  const now = performance.now()
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016
  lastT = now
  const want = engine.running ? LEVEL : 0
  if (want !== level) {
    if (!want) quietAt = now
    if (ctx && master) master.gain.setTargetAtTime(want, ctx.currentTime, want ? 0.45 : 0.18)
    level = want
  }
  if (!engine.running && now - quietAt > 900) {
    engine.rpm = 0
    engine.burnout = 0
    engine.throttle = 0
    raf = requestAnimationFrame(loop)
    return
  }
  const v = step(dt, now)
  if (ctx && node) {
    const t = ctx.currentTime
    const p = node.parameters
    // the revs glide between frames however slowly they come: the smoothing follows the real frame time
    const glide = Math.max(0.012, dt * 0.55)
    p.get('rpm')!.setTargetAtTime(v.rpm, t, glide)
    p.get('throttle')!.setTargetAtTime(v.throttle, t, Math.max(0.02, dt * 0.55))
    p.get('cut')!.setValueAtTime(v.cut, t)
    p.get('load')!.setTargetAtTime(v.load, t, 0.05)
    p.get('starter')!.setTargetAtTime(v.starter, t, 0.03)
    p.get('squeal')!.setTargetAtTime(v.squeal, t, 0.08)
    tone!.frequency.setTargetAtTime(toneHz(v), t, 0.05)
  }
  raf = requestAnimationFrame(loop)
}

export async function startEngine() {
  if (engine.running) return
  if (!ctx) await build()
  if (ctx!.state === 'suspended') await ctx!.resume()
  engine.running = true
  engine.rpm = 0
  engine.puff = 1
  startedAt = performance.now()
  lastT = 0
  level = LEVEL
  master!.gain.setTargetAtTime(LEVEL, ctx!.currentTime, 0.05)
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(loop)
  emit()
}

/** Kill silences the engine; the loop keeps watching so the drives between stops are still heard. */
export function stopEngine() {
  if (!engine.running) return
  engine.running = false
  engine.revving = false
  emit()
}

export function setRev(on: boolean) {
  if (!engine.running) return
  engine.revving = on
  if (!on) engine.puff = Math.max(engine.puff, 0.6)
  emit()
}

/** Offline rendering (dev only): restart the clock as if the key had just been turned. */
export function resetClock(now: number) { startedAt = now; cutUntil = 0 }

if (import.meta.env.DEV) (window as unknown as { __engine: typeof engine }).__engine = engine
