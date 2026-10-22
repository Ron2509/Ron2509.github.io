import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LINKS, PROJECTS } from './content'
import { STUDIES } from './studies'
import { store, useStore } from './store'

// "How it's built": a project told as a short case study over the studio, for someone who wants to know what it
// is, why it matters and what Raunak did, not only what it runs on. Opened from the project card on the
// Projects corner; Esc, the close button or the backdrop put it away, and the arrows step to the next project.

function Sheet({ i }: { i: number }) {
  const p = PROJECTS[i], s = STUDIES[i]
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.scrollTo({ top: 0 })
    box.current?.focus({ preventScroll: true })
  }, [i])
  const go = (d: number) => store.set({ study: (i + d + PROJECTS.length) % PROJECTS.length, step: (i + d + PROJECTS.length) % PROJECTS.length })
  return (
    <motion.div className="study" role="dialog" aria-modal="true" aria-label={`${p.name}: how it's built`}
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.35 } }} exit={{ opacity: 0, transition: { duration: 0.3 } }}
      onClick={(e) => { if (e.target === e.currentTarget) store.set({ study: null }) }}>
      <motion.div ref={box} className="study-sheet" tabIndex={-1} data-lenis-prevent
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ y: 24, opacity: 0, transition: { duration: 0.25 } }}>
        <button className="study-close" onClick={() => store.set({ study: null })} aria-label="Close">×</button>

        <header className="study-head">
          <span className="mono study-k">P{i + 1} · How it’s built · {p.year}</span>
          <h2>{p.name}</h2>
          <p className="study-one">{s.oneLiner}</p>
          <div className="study-meta">
            <span className="mono">{s.team}</span>
            <span className="study-links mono">
              {p.live && <a href={p.live} target="_blank" rel="noreferrer">Live demo ↗</a>}
              <a href={p.href ?? LINKS.githubRepos} target="_blank" rel="noreferrer">{p.href ? 'Code on GitHub' : 'GitHub profile'} ↗</a>
            </span>
          </div>
        </header>

        <section>
          <h3><i className="mono">01</i> The problem</h3>
          <p className="study-p">{s.problem}</p>
        </section>

        <section>
          <h3><i className="mono">02</i> How it works</h3>
          <ol className="flow">
            {s.flow.map((f, k) => (
              <li key={f.title}>
                <span className="mono flow-n">{String(k + 1).padStart(2, '0')}</span>
                <b>{f.title}</b>
                <p>{f.text}</p>
                <span className="mono flow-t">{f.tech}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="study-two">
          <div>
            <h3><i className="mono">03</i> What I did</h3>
            <ul className="did">{s.did.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <div>
            <h3><i className="mono">04</i> Results</h3>
            <div className="res">
              {s.results.map((r) => (
                <div key={r.k}><b>{r.v}</b><span className="mono">{r.k}</span><p>{r.note}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3><i className="mono">05</i> Hard parts &amp; decisions</h3>
          <div className="qa">
            {s.decisions.map((d) => <div key={d.q}><b>{d.q}</b><p>{d.a}</p></div>)}
          </div>
        </section>

        <section>
          <h3><i className="mono">06</i> Built with</h3>
          <div className="stack">
            {s.stack.map((g) => (
              <div key={g.k}><span className="mono">{g.k}</span><ul>{g.v.map((t) => <li key={t}>{t}</li>)}</ul></div>
            ))}
          </div>
        </section>

        <footer className="study-foot mono">
          <button onClick={() => go(-1)}>← {PROJECTS[(i - 1 + PROJECTS.length) % PROJECTS.length].short}</button>
          <span>{String(i + 1).padStart(2, '0')} / {String(PROJECTS.length).padStart(2, '0')}</span>
          <button onClick={() => go(1)}>{PROJECTS[(i + 1) % PROJECTS.length].short} →</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

export function CaseStudy() {
  const study = useStore((s) => s.study)
  const chapter = useStore((s) => s.chapter)
  // Esc closes it; leaving the Projects corner puts it away
  useEffect(() => {
    if (study === null) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') store.set({ study: null }) }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [study])
  useEffect(() => { if (chapter !== 2 && store.get().study !== null) store.set({ study: null }) }, [chapter])
  return <AnimatePresence>{study !== null && <Sheet key="study" i={study} />}</AnimatePresence>
}
