// Offline render of public/v8-worklet.js to a WAV, driving it like the site does:
// crank -> idle -> hold to rev (limiter) -> lift off (overrun crackle) -> idle.
// Usage: node scripts/render-v8.mjs out.wav
import { readFileSync, writeFileSync } from 'node:fs'

const SR = 48000
globalThis.sampleRate = SR
let Proc = null
globalThis.AudioWorkletProcessor = class {}
globalThis.registerProcessor = (_name, cls) => { Proc = cls }
new Function(readFileSync(new URL('../public/v8-worklet.js', import.meta.url), 'utf8'))()

const IDLE = 950, LIMIT = 9200
const proc = new Proc()
const secs = 11
const block = 128
const L = new Float32Array(SR * secs), R = new Float32Array(SR * secs)
let rpm = 0, thr = 0, cutUntil = 0, wander = 0

for (let pos = 0; pos < L.length; pos += block) {
  const t = pos / SR
  const dt = block / SR
  const now = t * 1000
  const revving = (t > 3.2 && t < 6.6) || (t > 8.2 && t < 8.55) || (t > 8.9 && t < 9.2) // a long hold, then two blips
  wander += (Math.random() - 0.5) * dt * 900; wander *= Math.exp(-dt * 1.5)
  let target = IDLE + wander, th = 0.06
  if (t < 1.1) { target = t < 0.5 ? 240 + Math.sin(t * 70) * 70 : t < 0.75 ? 4200 : 1800; th = t < 0.5 ? 0.02 : t < 0.75 ? 0.9 : 0.05 }
  else if (revving) { target = LIMIT + 400; th = 1 }
  if (revving && rpm >= LIMIT && now > cutUntil) cutUntil = now + 40 + Math.random() * 45
  const cutting = now < cutUntil
  if (cutting) { target = LIMIT - 1400; th = 0 }
  const up = 7000 + 9000 * Math.sin(Math.min(1, rpm / LIMIT) * Math.PI * 0.9)
  const rate = target > rpm ? up : cutting ? 26000 : 5200
  rpm += Math.sign(target - rpm) * Math.min(Math.abs(target - rpm), rate * dt)
  thr += (th - thr) * Math.min(1, dt * (cutting ? 60 : 16))
  const l = new Float32Array(block), r = new Float32Array(block)
  proc.process([], [[l, r]], { rpm: [rpm], throttle: [thr], cut: [cutting ? 1 : 0] })
  L.set(l.subarray(0, Math.min(block, L.length - pos)), pos)
  R.set(r.subarray(0, Math.min(block, R.length - pos)), pos)
}

// stats per second
let nan = 0
for (let s = 0; s < secs; s++) {
  let pk = 0, sum = 0
  for (let i = s * SR; i < (s + 1) * SR; i++) { const v = L[i]; if (!Number.isFinite(v)) nan++; pk = Math.max(pk, Math.abs(v)); sum += v * v }
  console.log(`t=${s}s peak ${pk.toFixed(3)} rms ${Math.sqrt(sum / SR).toFixed(3)}`)
}
console.log('non-finite samples:', nan)

// 16-bit stereo WAV
const n = L.length
const buf = Buffer.alloc(44 + n * 4)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * 1.4)) * 32767), 44 + i * 4)
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * 1.4)) * 32767), 46 + i * 4)
}
writeFileSync(process.argv[2] ?? 'v8-preview.wav', buf)
console.log('wrote', process.argv[2] ?? 'v8-preview.wav')
