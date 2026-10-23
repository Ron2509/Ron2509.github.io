import { useEffect } from 'react'
import { motion } from 'motion/react'
import { engine } from './engine'
import { LINKS } from './content'

// The end of the session: the garage's roller shutter comes down over the car. A heavy corrugated steel door on
// a chain: it gathers speed, runs down its guides with the slats rattling, lands on its rubber seal with a thud
// and a small bounce, and stays shut with the driver's name sprayed across it and where to find him. Restart lap
// or Get in touch rolls it back up.

/** when the door starts down, after the flag (s) */
export const SHUTTER_AT = 1.1
/** how long it takes to come down (s) */
export const SHUTTER_FALL = 2.1

let ac: AudioContext | null = null
/** The door's own sound, only when the visitor has the engine (and so sound) on: the slats rattling through the
 *  guides, then the thud of the bottom rail landing. */
function doorSound(up: boolean) {
  if (!engine.running) return
  try {
    ac ??= new AudioContext()
    if (ac.state === 'suspended') void ac.resume()
    const t0 = ac.currentTime + 0.02, run = up ? 1.3 : SHUTTER_FALL
    const noise = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    // rattle: band-passed noise chopped at the rate the slats pass the guide rollers
    const src = ac.createBufferSource(); src.buffer = noise
    const band = ac.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1100; band.Q.value = 0.8
    const chop = ac.createGain(); chop.gain.value = 0.5
    const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(7, t0); lfo.frequency.linearRampToValueAtTime(13, t0 + run * 0.6)
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.5
    lfo.connect(lfoAmt).connect(chop.gain)
    const env = ac.createGain()
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.05, t0 + 0.25)
    env.gain.setValueAtTime(0.05, t0 + run - 0.15); env.gain.linearRampToValueAtTime(0, t0 + run)
    src.connect(band).connect(chop).connect(env).connect(ac.destination)
    src.start(t0); src.stop(t0 + run + 0.1); lfo.start(t0); lfo.stop(t0 + run + 0.1)
    if (up) return
    // the landing: a low thump of the rail on the floor, and the clatter of the slats settling
    const tl = t0 + run
    const thump = ac.createOscillator(); thump.frequency.setValueAtTime(70, tl); thump.frequency.exponentialRampToValueAtTime(38, tl + 0.35)
    const tg = ac.createGain(); tg.gain.setValueAtTime(0.0001, tl); tg.gain.exponentialRampToValueAtTime(0.32, tl + 0.01); tg.gain.exponentialRampToValueAtTime(0.0001, tl + 0.5)
    thump.connect(tg).connect(ac.destination); thump.start(tl); thump.stop(tl + 0.55)
    const clat = ac.createBufferSource(); clat.buffer = noise
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900
    const cg = ac.createGain(); cg.gain.setValueAtTime(0.12, tl); cg.gain.exponentialRampToValueAtTime(0.0001, tl + 0.35)
    clat.connect(lp).connect(cg).connect(ac.destination); clat.start(tl, 1); clat.stop(tl + 0.4)
  } catch { /* no sound is fine */ }
}

export function Shutter() {
  useEffect(() => {
    const t0 = performance.now()
    const id = setTimeout(() => doorSound(false), SHUTTER_AT * 1000)
    // rolling back up is only heard if it had come down
    return () => { clearTimeout(id); if (performance.now() - t0 > SHUTTER_AT * 1000) doorSound(true) }
  }, [])
  const fall = { duration: SHUTTER_FALL + 0.35, delay: SHUTTER_AT, times: [0, 0.12, 0.86, 0.92, 1], ease: ['easeIn', 'linear', 'easeOut', 'easeInOut'] as ('easeIn' | 'linear' | 'easeOut' | 'easeInOut')[] }
  return (
    <motion.div className="shutter" aria-hidden="false"
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.3, delay: SHUTTER_AT - 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.3, delay: 1.2 } }}>
      <i className="shutter-rail l" /><i className="shutter-rail r" />
      {/* the housing the door rolls out of, across the top */}
      <i className="shutter-housing" />
      <motion.div className="shutter-door"
        initial={{ y: '-101%' }}
        animate={{ y: ['-101%', '-88%', '0%', '-0.7%', '0%'], transition: fall }}
        exit={{ y: '-101%', transition: { duration: 1.3, ease: [0.45, 0, 0.6, 1] } }}>
        <div className="shutter-face" />
        <div className="shutter-paint">
          <span className="mono shutter-k">Garage 07 · session closed</span>
          <h2>Raunak Saoji</h2>
          <span className="mono shutter-sub">Software engineer · Bangalore</span>
          <nav className="shutter-plates" aria-label="Contact">
            <a href={`mailto:${LINKS.email}`}><span className="mono">Email</span>{LINKS.email}</a>
            <a href={LINKS.github} target="_blank" rel="noreferrer"><span className="mono">GitHub</span>Ron2509</a>
            <a href={LINKS.linkedin} target="_blank" rel="noreferrer"><span className="mono">LinkedIn</span>raunak-saoji</a>
          </nav>
        </div>
        <div className="shutter-bar"><i /><i /></div>
      </motion.div>
    </motion.div>
  )
}
