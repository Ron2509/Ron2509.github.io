// Everything about the driver, in one place. Taken from the resume and the GitHub READMEs.

export const LINKS = {
  email: 'raunaksaoji@gmail.com',
  github: 'https://github.com/Ron2509',
  githubRepos: 'https://github.com/Ron2509?tab=repositories',
  linkedin: 'https://www.linkedin.com/in/raunak-saoji/',
}

export const PROFILE = {
  lede:
    'Building frontier AI for India at Soket AI Labs. Agent harnesses, model serving, payments, search, RAG and LLM evaluation, shipped to production.',
  about:
    'Member of Technical Staff at Soket AI Labs, working on Loop, our open-source harness for long-running agent work, and the console that serves the models. Before that: payments, checkout, search and access control at a funded startup, LLM evaluation and DevOps for an international team, and ML for the Government of India.',
  /** the setup sheet: everything in the toolbox, grouped like a car's spec */
  skills: [
    { k: 'Languages', v: ['Python', 'TypeScript', 'JavaScript', 'Java', 'C++', 'Rust', 'SQL'] },
    { k: 'AI & agents', v: ['LLMs', 'RAG', 'Agentic workflows', 'MCP', 'CrewAI', 'LLM-as-judge evals', 'Claude Code'] },
    { k: 'ML & vision', v: ['TensorFlow / Keras', 'PyTorch', 'scikit-learn', 'OpenCV', 'Random Forest, KNN'] },
    { k: 'Backend & web', v: ['Node.js', 'Next.js', 'React', 'Medusa.js', 'REST APIs', 'JWT auth, RBAC'] },
    { k: 'Data & search', v: ['PostgreSQL', 'MySQL', 'Redis', 'ChromaDB', 'Typesense', 'Vector search, HNSW'] },
    { k: 'Infra & cloud', v: ['Docker', 'GitHub Actions', 'CI/CD', 'Bash', 'Git', 'Google Vertex AI'] },
    { k: 'Commerce', v: ['Payments & checkout', 'GoKwik, Cashfree', 'Google Merchant Center', 'Referral payouts'] },
  ],
  offTrack: ['Reading books', 'Playing football', 'Watching F1', 'Fighter planes'],
  education: 'B.Tech, Computer Science & Engineering · Amity University · 2022–2026',
  based: 'Bangalore, India',
  now: 'Member of Technical Staff, Soket AI Labs',
}

/** Car parts a block can point at; positions are found on the model at load (Car.tsx). */
export type Anchor = 'nose' | 'halo' | 'sidepod' | 'engine' | 'rearwing'
export const ANCHOR_LABEL: Record<Anchor, string> = {
  nose: 'Nose cone', halo: 'Halo', sidepod: 'Sidepod', engine: 'Power unit', rearwing: 'Rear wing',
}

/** The car's assemblies on the Projects corner's exploded drawing (see explode.ts). */
export type AssemblyId =
  | 'fwing' | 'beam' | 'rwing' | 'wheels' | 'rwheels' | 'fsusp' | 'rsusp' | 'mirrors' | 'halo' | 'cooling' | 'cockpit' | 'body' | 'pu' | 'floor'
/** How a project works, told on the pulled-apart car: one step per assembly, in order nose to tail. Each
 *  project takes the car apart its own way, so no two pull the same set of parts. */
export type Step = { on: AssemblyId; title: string; line: string }
/** A hard number off the project, read at a glance like a timing screen. */
export type Stat = { v: string; k: string }
export type Project = { name: string; short: string; kind: string; year: string; note?: string; href?: string; live?: string; badge?: string; tags: string[]; anchor: Anchor; brief: Step[]; stats: Stat[] }

export const PROJECTS: Project[] = [
  {
    name: 'Driver Drowsiness Detection',
    short: 'Drowsiness AI',
    tags: ['CNN-LSTM', 'TensorFlow', 'OpenCV', 'SUST-DDD', 'IEEE'],
    anchor: 'halo',
    brief: [
      { on: 'mirrors', title: 'Webcam in', line: 'live frames, 64×64 RGB' },
      { on: 'halo', title: 'CNN on every frame', line: '32 · 64 · 128 filters, batch norm' },
      { on: 'cooling', title: '16-frame buffer', line: 'rolling, oldest frame out' },
      { on: 'cockpit', title: 'LSTM over time', line: '128 then 64 units: a trend, not a blink' },
      { on: 'rsusp', title: 'Two signals agree', line: 'model streak + Haar eye-closed streak' },
      { on: 'rwing', title: 'Alarm', line: 'beep, then the counters reset' },
    ],
    kind: 'CNN-LSTM on live video · real-time fatigue alerts · TensorFlow, OpenCV',
    year: '2026',
    badge: 'IEEE accepted',
    stats: [{ v: '84.62%', k: 'test accuracy' }, { v: '16', k: 'frame window' }, { v: '2', k: 'checks agree' }],
    note: 'A blink is not fatigue: the alarm waits for the model and a Haar eye check to agree over a run of frames. Paper accepted by IEEE, publishing Dec 2026 – Jan 2027.',
  },
  {
    name: 'DRS: Multimodal Emotion Recognition',
    short: 'Emotion AI',
    tags: ['TensorFlow', 'Keras', 'OpenCV', 'FER2013', 'RAVDESS'],
    anchor: 'nose',
    brief: [
      { on: 'fwing', title: 'Camera and mic', line: 'the face and the speech, together' },
      { on: 'wheels', title: 'Face: Haar + 48×48', line: 'every face cropped, scaled 0–1' },
      { on: 'body', title: 'Face CNN', line: '4 conv blocks, 7 emotions, FER2013' },
      { on: 'floor', title: 'Voice tone', line: 'how it was said, trained on RAVDESS' },
      { on: 'pu', title: 'Transcript sentiment', line: 'what was said, read as text' },
      { on: 'rwheels', title: 'One verdict', line: 'face, voice and text reconciled' },
    ],
    kind: 'Face, voice and text fused into one verdict · TensorFlow, OpenCV',
    year: '2025',
    stats: [{ v: '3', k: 'channels fused' }, { v: '7', k: 'emotions' }, { v: '28,821', k: 'training faces' }],
    note: 'Three reads of one moment: a CNN on the face, a RAVDESS-trained model on the tone of voice and sentiment on the transcript, reconciled into one emotion. The face model was trained from scratch on FER2013.',
    href: 'https://github.com/Ron2509/Facial-emotion-Recognition',
  },
  {
    name: 'Circle Sell-Flow',
    short: 'Sell-Flow',
    tags: ['Next.js 16', 'Postgres · JSONB', 'Prisma', 'Zod', 'Gemini'],
    anchor: 'sidepod',
    brief: [
      { on: 'fwing', title: 'Seller speaks or types', line: 'raw audio to Gemini, Hinglish included' },
      { on: 'fsusp', title: 'Gemini, constrained', line: 'dropdown options become its enums' },
      { on: 'halo', title: 'One form engine', line: '9 field types, knows no category' },
      { on: 'cooling', title: 'Zod, built at runtime', line: 'same rows in browser and server: 422' },
      { on: 'beam', title: 'Postgres hybrid', line: 'questions as rows, answers in JSONB' },
      { on: 'rwheels', title: 'Reviewed lifecycle', line: 'pending → incomplete → live → sold' },
    ],
    kind: 'Schema-driven C2C listing engine · Next.js 16, Postgres, Prisma, Gemini',
    year: '2026',
    stats: [{ v: '0', k: 'code per shelf' }, { v: '1', k: 'source of truth' }, { v: '3', k: 'model fallbacks' }],
    note: 'The form, the server check and the AI are all generated from the same database rows, so they cannot drift. An unknown item still lists today: AI drafts its questions, an admin approves the shelf.',
    href: 'https://github.com/Ron2509/circle-sell-flow',
    live: 'https://circle-sell-flow-ochre.vercel.app',
  },
  {
    name: 'MoneyMoves',
    short: 'MoneyMoves',
    tags: ['Kotlin', 'React Native', 'SQLite', 'Expo'],
    anchor: 'engine',
    brief: [
      { on: 'wheels', title: 'Bank SMS arrives', line: 'Kotlin receiver, app closed or not' },
      { on: 'fsusp', title: 'Sender check', line: 'DLT codes like HDFCBK: no phone can fake one' },
      { on: 'mirrors', title: 'Field-by-field parser', line: 'amount, payee, ref; OTPs, failures out' },
      { on: 'cockpit', title: 'One SQLite ledger', line: 'one writer; bank ref stops duplicates' },
      { on: 'floor', title: 'Quick sheet', line: 'all mine or ÷2 ÷3 ÷4, from the notification' },
      { on: 'beam', title: 'Can’t go online', line: 'INTERNET stripped from the release build' },
    ],
    kind: 'Offline Android expense tracker that builds itself from bank SMS',
    year: '2026',
    stats: [{ v: '5', k: 'banks parsed' }, { v: '37', k: 'parser tests' }, { v: '0', k: 'network access' }],
    note: 'Every bank format was written from real messages and pinned by JVM tests. File the same payee the same way twice and it files itself from then on.',
    href: 'https://github.com/Ron2509/moneymoves',
  },
]

/** Second-year basics, built in free time. */
export const PIT_LANE = [
  { name: 'Snake', href: 'https://github.com/Ron2509?tab=repositories' },
  { name: 'Rock Paper Scissors', href: 'https://github.com/Ron2509/rock-paper-scissor-beginner-game' },
  { name: 'Tic-Tac-Toe', href: 'https://github.com/Ron2509/tic-tac-toe-game-basic' },
]

export type Role = {
  company: string; role: string; where: string; when: string; now?: boolean; points: string[]; anchor: Anchor
  /** a headline number that counts up, or a word when the work isn't a number */
  metric?: { v: number; unit: string; sign?: string; k: string }
  headline?: { v: string; k: string }
  href?: string
  links?: { label: string; href: string }[]
}

export const EXPERIENCE: Role[] = [
  {
    company: 'Soket AI Labs',
    role: 'Member of Technical Staff',
    where: 'Bangalore',
    when: 'Sep 2026 – Present',
    now: true,
    headline: { v: 'LOOP', k: 'open-source agent harness · developer preview' },
    href: 'https://soket.ai/',
    links: [{ label: 'Loop console', href: 'https://console.soket.ai/signin' }, { label: 'soket.ai', href: 'https://soket.ai/' }],
    points: [
      'Frontier AI lab building sovereign models and agents for India.',
      'Shipped Loop, our open-source Rust harness for long-running agent work, now in developer preview.',
      'Worked across both sides of it: the harness, and the console that serves the models.',
    ],
    anchor: 'engine',
  },
  {
    company: 'For Real',
    role: 'Founding Engineer',
    where: 'Bangalore',
    when: 'Jan 2026 – Aug 2026',
    metric: { v: 57, unit: '%', sign: '−', k: 'Place Order API latency' },
    points: [
      'Migrated checkout to GoKwik One Click with silent login: Place Order API 3.5s → 1.5s.',
      'Semantic search on Typesense with Vertex AI and FashionSigLIP embeddings, +2% conversion.',
      'RBAC with scoped middleware on every route, and seller impersonation via short-lived JWTs.',
      'Took a 50,000+ SKU catalog live on Google Shopping; built an idempotent referral payout.',
    ],
    anchor: 'sidepod',
  },
  {
    company: 'Crowd Wisdom Trading',
    role: 'LLM & DevOps Engineer',
    where: 'Israel · Remote',
    when: 'Jul 2025 – Dec 2025',
    metric: { v: 90, unit: '%', sign: '−', k: 'manual QA time' },
    links: [{ label: 'crowdwisdomtrading.com', href: 'https://www.crowdwisdomtrading.com/' }],
    points: [
      'Dockerised CI/CD on GitHub Actions: deployments from manual to 100% automated.',
      'LLM-as-judge evaluation with CrewAI scoring RAG answers for relevance and grounding.',
      'Live ingestion from YouTube, Discord and Yahoo Finance into ChromaDB, accuracy 55% → 85%.',
    ],
    anchor: 'rearwing',
  },
  {
    company: 'C-DOT, Govt. of India',
    role: 'AI/ML Developer Intern',
    where: 'New Delhi',
    when: 'May 2025 – Jul 2025',
    metric: { v: 80, unit: '%', k: 'room-level accuracy' },
    points: [
      'BLE indoor positioning from RSSI with ML classification, where GPS can’t reach.',
      'Modelled 200,000+ signal samples with Random Forest and KNN; scaled to 20+ zones.',
    ],
    anchor: 'nose',
  },
]
