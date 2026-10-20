// Big-block cross-plane V8 with dual exhaust, the late-60s muscle-car sound, physically flavoured.
// - Every firing sends a blowdown pulse down its bank's pipe. The pulse is a fixed slice of crank angle, so
//   it is long and thumpy at idle and short and hard at the top. The uneven L R L L R L R R bank order of a
//   cross-plane crank is what makes the burble; each bank is panned to its own tailpipe.
// - A long-overlap cam: at idle one cylinder runs lazy, now and then one misses and the next lands heavy (lope).
// - Glasspack mufflers: the low body is always there, the rasp opens up with throttle.
// - Overrun and rev-limiter cuts: unburnt fuel lights off in the hot pipes (pops, crackle, bangs).
// - Around it: starter motor and the rear tyres screaming in a burnout. (The drives between stops are a real F1
//   recording, played by engine.ts, not this.)

const BANK = [0, 1, 0, 0, 1, 0, 1, 1]
// each cylinder breathes through a slightly different primary, so each has its own strength
const CYL = [1.0, 0.84, 1.14, 0.93, 1.08, 0.8, 1.18, 0.9]
const TAU = Math.PI * 2
// gain into the saturator: idle sits clean, full throttle leans into it
const PRE = 0.34

class Pipe {
  constructor(seconds, feedback, damping) {
    this.len = seconds * sampleRate
    this.buf = new Float32Array(Math.ceil(this.len) + 4)
    this.w = 0
    this.fb = feedback
    this.damp = damping
    this.lp = 0
  }
  tick(x) {
    const n = this.buf.length
    let r = this.w - this.len
    while (r < 0) r += n
    const i0 = r | 0
    const f = r - i0
    const y = this.buf[i0 % n] * (1 - f) + this.buf[(i0 + 1) % n] * f
    this.lp += (y - this.lp) * this.damp // wall losses: highs die faster
    const out = x - this.lp * this.fb // open end reflects inverted
    this.buf[this.w] = out
    this.w = (this.w + 1) % n
    return out
  }
}

class Reso {
  // two-pole band-pass, normalised to unity gain at the centre, retunable per block
  constructor() { this.y1 = 0; this.y2 = 0; this.a1 = 0; this.a2 = 0; this.g = 0 }
  tune(freq, q) {
    const w = (TAU * Math.min(freq, sampleRate * 0.45)) / sampleRate
    const r = Math.exp(-w / (2 * q))
    this.a1 = 2 * r * Math.cos(w)
    this.a2 = -r * r
    this.g = (1 - r * r) * 0.5
  }
  tick(x) {
    const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

class Lp {
  constructor() { this.y = 0; this.a = 1 }
  set(hz) { this.a = 1 - Math.exp((-TAU * hz) / sampleRate) }
  tick(x) { this.y += (x - this.y) * this.a; return this.y }
}

class Dc {
  // DC blocker / gentle high-pass
  constructor(hz) { this.x1 = 0; this.y1 = 0; this.r = Math.exp((-TAU * hz) / sampleRate) }
  tick(x) { const y = x - this.x1 + this.r * this.y1; this.x1 = x; this.y1 = y; return y }
}

class V8 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, max = 1) => ({ name, defaultValue: 0, minValue: -max, maxValue: max, automationRate: 'k-rate' })
    return [k('rpm', 20000), k('throttle'), k('cut'), k('load'), k('starter'), k('squeal')]
  }

  constructor() {
    super()
    this.seed = 22222
    this.phase = 0
    this.cyl = 0
    this.gap = 1
    // a slot per bank, plus one spare so a long idle pulse is never cut off by the next
    this.pulses = [0, 1, 2, 3].map(() => ({ bank: 0, t: 0, len: 0, amp: 0 }))
    this.slot = 0
    this.pipes = [new Pipe(1 / 104, 0.46, 0.22), new Pipe(1 / 117, 0.44, 0.24)]
    this.collector = new Pipe(1 / 47, 0.3, 0.16)
    this.body = [new Reso(), new Reso()]
    this.throat = [new Reso(), new Reso()]
    this.muff = [[new Lp(), new Lp()], [new Lp(), new Lp()]]
    this.rasp = [new Reso(), new Reso()]
    this.dcL = new Dc(22); this.dcR = new Dc(22)
    this.crack = 0
    this.crackAmp = 0
    this.crackle = new Reso()
    this.intake = new Reso()
    this.intakeEnv = 0
    this.weak = 3
    this.heavy = -1
    this.starterPhase = 0
    this.starterLp = new Lp()
    this.tyre = [new Reso(), new Reso(), new Reso()]
    this.slip = 0
    this.slipTarget = 0
    this.slipHold = 0
    this.tyreHiss = new Reso()
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  fire(rpm, throttle, cut, load, starter) {
    const bank = BANK[this.cyl]
    const idle = Math.max(0, 1 - rpm / 2200)
    const overrun = throttle < 0.06 && rpm > 2300
    // louder with mass flow: revs and throttle together
    let amp = (0.15 + throttle * 1.0 + load * 0.3) * CYL[this.cyl] * (0.5 + 0.5 * Math.min(1, rpm / 5000))
    // combustion varies cycle to cycle: lumpy at idle, tight at speed
    amp *= 1 + (this.rand() - 0.5) * (0.1 + idle * 0.55)
    if (this.cyl === this.weak) amp *= 0.5 + 0.4 * (1 - idle)
    if (this.cyl === this.heavy) { amp *= 1.35; this.heavy = -1 }
    // big cam at idle: the odd miss, and the charge it leaves behind lights the next one hard
    if (idle > 0.4 && this.rand() < 0.05 * idle) { amp *= 0.15; this.heavy = (this.cyl + 1) % 8 }
    let pop = false
    if (cut || overrun) {
      amp = 0.08
      pop = this.rand() < (cut ? 0.4 : 0.12)
    }
    if (pop) {
      amp = 0.9 + this.rand() * 0.9
      this.crack = Math.floor(sampleRate * (0.01 + this.rand() * 0.035))
      this.crackAmp = 0.35 + this.rand() * 0.5
    }
    // cranking: compression strokes only, no fire
    if (starter > 0.5) amp = 0.12 + this.rand() * 0.05
    // the blowdown lasts a fixed slice of crank angle (about 45 degrees), clamped so it never smears
    const sec = Math.min(0.0085, Math.max(0.0011, (45 / 360) * (60 / Math.max(rpm, 200))))
    const p = this.pulses[this.slot]
    this.slot = (this.slot + 1) % this.pulses.length
    p.bank = bank
    p.t = 0
    p.len = Math.floor(sampleRate * (pop ? sec * 1.6 : sec))
    p.amp = amp
    if (!cut && !overrun) this.intakeEnv = 1
    // next firing, with a little timing jitter
    this.gap = 1 + (this.rand() - 0.5) * (0.015 + idle * 0.06)
    this.cyl = (this.cyl + 1) % 8
    if (this.cyl === 0 && this.rand() < 0.3) this.weak = (this.rand() * 8) | 0
  }

  process(_in, outputs, params) {
    const out = outputs[0]
    const L = out[0]
    const R = out[1] || out[0]
    const rpm = params.rpm[0]
    const throttle = params.throttle[0]
    const cut = params.cut[0] > 0.5
    const load = params.load[0]
    const starter = params.starter[0]
    const squeal = params.squeal[0]
    const fireRate = (rpm / 60) * 4
    const dt = 1 / sampleRate
    const r7 = Math.min(1.15, rpm / 7000)

    // per-block tuning
    for (let b = 0; b < 2; b++) {
      this.body[b].tune(78 + b * 9 + rpm * 0.004, 1.3)
      this.throat[b].tune(380 + b * 40 + rpm * 0.03, 2.2)
      // glasspacks open up with throttle and revs
      const open = 1100 + throttle * 1600 + Math.min(rpm, 8000) * 0.2 + load * 400
      this.muff[b][0].set(open); this.muff[b][1].set(open * 1.4)
      this.rasp[b].tune(1350 + Math.min(rpm, 8000) * 0.16 + b * 120, 1.2)
    }
    this.crackle.tune(2400 + this.rand() * 800, 1.6)
    this.intake.tune(260 + rpm * 0.07, 3.2)
    this.starterLp.set(520)

    // rear tyres: stick-slip makes the scream wobble and stutter
    if (squeal > 0.01) {
      this.slipHold -= 128
      if (this.slipHold <= 0) {
        this.slipTarget = 0.35 + this.rand() * 0.65
        this.slipHold = sampleRate * (0.025 + this.rand() * 0.07)
      }
      const f0 = 980 + this.slip * 260 + (this.rand() - 0.5) * 40
      this.tyre[0].tune(f0, 30)
      this.tyre[1].tune(f0 * 2.03, 24)
      this.tyre[2].tune(f0 * 3.11, 16)
      this.tyreHiss.tune(3600, 0.8)
    }

    for (let i = 0; i < L.length; i++) {
      if (rpm > 60) {
        this.phase += (fireRate * dt) / this.gap
        if (this.phase >= 1) { this.phase -= 1; this.fire(rpm, throttle, cut, load, starter) }
      }

      // blowdown pulses into each bank, plus a breathy grain of noise riding on them
      let x0 = 0, x1 = 0, env0 = 0, env1 = 0
      for (let k = 0; k < this.pulses.length; k++) {
        const p = this.pulses[k]
        if (p.t >= p.len) continue
        const u = p.t / p.len
        // sharp rise, long fall, then a little suction as the pipe empties
        const shape = (u < 0.12 ? Math.sin((Math.PI / 2) * (u / 0.12)) : Math.exp(-(u - 0.12) * 4.2)) - 0.16 * Math.sin(Math.PI * u)
        const v = p.amp * shape * (1 - u)
        if (p.bank === 0) { x0 += v; env0 += Math.abs(v) } else { x1 += v; env1 += Math.abs(v) }
        p.t++
      }
      const n0 = this.rand() * 2 - 1
      const n1 = this.rand() * 2 - 1
      const p0 = this.pipes[0].tick(x0 * (1 + n0 * 0.12))
      const p1 = this.pipes[1].tick(x1 * (1 + n1 * 0.12))
      const col = this.collector.tick((p0 + p1) * 0.5)

      const ex = [p0, p1]
      const envs = [env0, env1]
      const noise = [n0, n1]
      const bankOut = [0, 0]
      for (let b = 0; b < 2; b++) {
        const m = this.muff[b][1].tick(this.muff[b][0].tick(ex[b] + col * 0.6))
        const chest = this.body[b].tick(ex[b]) * 0.55
        const throat = this.throat[b].tick(ex[b]) * 0.9
        const rasp = this.rasp[b].tick(noise[b] * envs[b]) * (0.3 + throttle * 0.6 + load * 0.3) * (0.55 + r7)
        bankOut[b] = m * 1.1 + chest + throat + rasp * 2.2
      }

      // pops after a cut: bright crackle
      let ck = 0
      if (this.crack > 0) {
        ck = this.crackle.tick((this.rand() * 2 - 1) * this.crackAmp) * (this.rand() < 0.3 ? 3.5 : 1)
        this.crack--
      }
      // four-barrel sucking air, gated by induction strokes
      this.intakeEnv *= 0.9975
      const ik = this.intake.tick(this.rand() * 2 - 1) * this.intakeEnv * throttle * (0.3 + r7) * 0.8

      // dual exhaust: each bank mostly in its own side
      let l = (bankOut[0] * 0.86 + bankOut[1] * 0.3 + ik + ck) * PRE
      let r = (bankOut[1] * 0.86 + bankOut[0] * 0.3 + ik * 0.85 + ck * 0.8) * PRE
      // warm, slightly asymmetric saturation: even harmonics, the throaty growl
      l = Math.tanh(l + 0.15 * l * l) * 0.8
      r = Math.tanh(r + 0.15 * r * r) * 0.8
      l = this.dcL.tick(l)
      r = this.dcR.tick(r)

      // starter motor: a low electric whirr, not a buzz. It slows and labours on each compression stroke,
      // so the cranking chugs; the gear mesh is a soft second harmonic with a little grit in it
      if (starter > 0.01) {
        const drag = Math.abs(Math.sin(this.phase * Math.PI))
        this.starterPhase += (150 - drag * 28) * dt
        const a = TAU * this.starterPhase
        const whirr = Math.sin(a) * 0.7 + Math.sin(2 * a) * 0.22 + (this.rand() * 2 - 1) * 0.18
        const s = this.starterLp.tick(whirr) * (0.4 + 0.6 * drag) * starter * 0.11
        l += s; r += s
      }

      // rear tyres in a burnout
      if (squeal > 0.01) {
        this.slip += (this.slipTarget - this.slip) * 0.0016
        const tn = this.rand() * 2 - 1
        const sc = (this.tyre[0].tick(tn) + this.tyre[1].tick(tn) * 0.55 + this.tyre[2].tick(tn) * 0.3) * 9
        const hiss = this.tyreHiss.tick(tn) * 0.6
        const t = (sc * (0.45 + 0.55 * this.slip) + hiss) * squeal * 0.24
        l += t; r += t * 0.92
      }

      L[i] = l
      if (R !== L) R[i] = r
    }
    return true
  }
}

registerProcessor('v8-engine', V8)
