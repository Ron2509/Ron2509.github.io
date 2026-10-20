// The "sponsors" on the car are the portfolio itself: every corner of the lap repaints the car with a new
// set of partner marks, so the bodywork tells the visitor about the driver as they pass.

/** Lockup styles, drawn like real sponsor marks rather than plain text. */
export type DecalStyle = 'bold' | 'box' | 'emblem' | 'stack' | 'outline' | 'mono' | 'script' | 'num'

export type Sponsor = { text: string; style: DecalStyle }
export type SponsorSet = { id: string; label: string; marks: Sponsor[] }

// slot order (see liveries.ts): 0 sidepod (core) · 1 engine-cover shoulder · 2 lower sidepod · 3 nose flank (core)
// · 4 coke-bottle (core) · 5 sidepod tops · 6 engine-cover spine · 7 nose top
const CORE: Sponsor = { text: '', style: 'mono' }
const set = (id: string, label: string, m: [Sponsor, Sponsor, Sponsor, Sponsor, Sponsor]): SponsorSet => ({
  id, label, marks: [CORE, m[0], m[1], CORE, CORE, m[2], m[3], m[4]],
})

export const SPONSOR_SETS: SponsorSet[] = [
  set('identity', 'Title partner · the driver', [
    { text: 'RS', style: 'bold' },
    { text: 'SOKET AI LABS', style: 'box' },
    { text: 'RAUNAK', style: 'bold' },
    { text: 'BANGALORE · INDIA', style: 'mono' },
    { text: 'SAOJI', style: 'mono' },
  ]),
  set('profile', 'Off track · books, football, F1, jets', [
    { text: 'BOOKS', style: 'bold' },
    { text: 'FIGHTER JETS', style: 'box' },
    { text: 'FORMULA 1', style: 'bold' },
    { text: 'RAG · LLM · DEVOPS', style: 'mono' },
    { text: 'AMITY CSE', style: 'mono' },
  ]),
  set('projects', 'Race winners · projects', [
    { text: 'IEEE', style: 'bold' },
    { text: 'DROWSINESS AI', style: 'box' },
    { text: 'MONEYMOVES', style: 'bold' },
    { text: 'GITHUB.COM/RON2509', style: 'mono' },
    { text: 'SELL-FLOW', style: 'mono' },
  ]),
  set('experience', 'Teams · Soket AI Labs, For Real, Crowd Wisdom, C-DOT', [
    { text: 'LOOP', style: 'bold' },
    { text: 'SOKET AI LABS', style: 'box' },
    { text: 'FOR REAL', style: 'bold' },
    { text: 'MEMBER OF TECHNICAL STAFF', style: 'mono' },
    { text: 'C-DOT', style: 'mono' },
  ]),
  set('pitwall', 'Pit wall · the AI wire', [
    { text: 'WIRE', style: 'bold' },
    { text: 'LIVE FEED', style: 'box' },
    { text: 'AI · TECH', style: 'bold' },
    { text: 'UPDATED DAILY', style: 'mono' },
    { text: 'PIT WALL', style: 'mono' },
  ]),
  set('contact', 'Get in touch', [
    { text: 'HELLO', style: 'bold' },
    { text: "LET'S BUILD", style: 'box' },
    { text: 'SAY HI', style: 'bold' },
    { text: 'RAUNAKSAOJI@GMAIL.COM', style: 'mono' },
    { text: 'LINKEDIN', style: 'mono' },
  ]),
]
