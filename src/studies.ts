// The long form of each project, for the "How it's built" sheet (CaseStudy.tsx): what it is in one plain
// sentence, the problem, how it works step by step, what Raunak did (honestly: the team projects say whose part
// was whose), the hard decisions, the results and the stack. Written from the project report, the notebooks
// and the repositories, for someone who is not an engineer as much as for someone who is.

export type CaseStudy = {
  oneLiner: string
  team: string
  problem: string
  /** how it works, in order: plain words first, the technology small underneath */
  flow: { title: string; text: string; tech: string }[]
  did: string[]
  decisions: { q: string; a: string }[]
  results: { v: string; k: string; note: string }[]
  stack: { k: string; v: string[] }[]
}

/** In the same order as PROJECTS (content.ts). */
export const STUDIES: CaseStudy[] = [
  {
    oneLiner: 'A camera system that notices when a driver is falling asleep and sounds an alarm before it is too late.',
    team: 'Final-year B.Tech project · team of 3 · paper accepted by IEEE',
    problem:
      'Drowsy driving causes a large share of serious road accidents, and drivers rarely notice their own fatigue. Simple detectors look at one photo at a time, so they confuse an ordinary blink with sleepiness: they either miss real fatigue or beep all the time.',
    flow: [
      { title: 'Watch the driver', text: 'A webcam streams the driver’s face. Every frame is resized to 64 × 64 pixels.', tech: 'OpenCV' },
      { title: 'Understand each frame', text: 'A neural network for images (a CNN) turns each frame into features: eyes, head position, yawning.', tech: 'CNN · 32 / 64 / 128 filters' },
      { title: 'Keep the last few moments', text: 'The latest 16 frames sit in a rolling buffer, so the system sees a short clip, not a single photo.', tech: 'Rolling 16-frame buffer' },
      { title: 'Spot the trend', text: 'A second network reads the clip in order and learns what getting tired looks like over time, as opposed to a quick blink.', tech: 'LSTM · 128 → 64 units' },
      { title: 'Double-check', text: 'A classic eye detector checks separately whether the eyes have stayed shut. Both must agree over several frames in a row.', tech: 'Haar cascades' },
      { title: 'Wake the driver', text: 'Only then does it beep and show DROWSY on screen, then reset so the next warning starts fresh.', tech: 'Audio alert' },
    ],
    did: [
      'Compared the candidate approaches (standalone CNNs, classic machine-learning classifiers, recurrent models) and helped settle on CNN-LSTM.',
      'Fought overfitting: tuned dropout after the LSTM and dense layers, and added early stopping and learning-rate reduction.',
      'Built the real-time alarm with a teammate, so the beep fires only after drowsiness holds across several frames, never on a blink.',
      'Part of the three-person team whose paper was accepted by IEEE (publishing Dec 2026 – Jan 2027).',
    ],
    decisions: [
      { q: 'Why video, not single photos?', a: 'Fatigue is a pattern over time: slow, heavy blinks and a drooping head. A model that reads 16 frames in order can tell that apart from a normal blink. One that sees a single frame cannot.' },
      { q: 'Why two detectors instead of one?', a: 'A neural network’s confidence wobbles with lighting and head angle. A simple eye-closure check is a second opinion, and the alarm needs both to agree over several frames, which cuts false alarms.' },
      { q: 'How did we stop the model memorising the dataset?', a: 'Dropout, batch normalisation, early stopping and lowering the learning rate when progress stalled, tuned over many training runs.' },
    ],
    results: [
      { v: '84.62%', k: 'test accuracy', note: 'on the SUST-DDD driver video dataset, with balanced precision and recall' },
      { v: '16', k: 'frames per decision', note: 'every prediction reads a short clip in order, not one photo' },
      { v: 'IEEE', k: 'paper accepted', note: 'publishing Dec 2026 – Jan 2027' },
    ],
    stack: [
      { k: 'Model', v: ['TensorFlow / Keras', 'CNN', 'LSTM', 'AdamW'] },
      { k: 'Vision', v: ['OpenCV', 'Haar cascades'] },
      { k: 'Data', v: ['SUST-DDD video dataset'] },
      { k: 'Language', v: ['Python'] },
    ],
  },
  {
    oneLiner: 'An AI that reads how someone feels from their face, their tone of voice and their words, and combines the three into one answer.',
    team: 'Team project · my part: the face model',
    problem:
      'Emotion is easy to misread from a single signal. A smile can hide frustration, and someone can say “I’m fine” in an angry voice. Systems that only look at faces miss half the story.',
    flow: [
      { title: 'Capture', text: 'A camera and a microphone record the person at the same moment.', tech: 'OpenCV · audio' },
      { title: 'Find the face', text: 'A face detector crops the face, turns it into a 48 × 48 greyscale image and scales it.', tech: 'Haar cascade' },
      { title: 'Read the face', text: 'A network trained from scratch on 28,821 labelled faces picks one of 7 emotions: angry, disgust, fear, happy, neutral, sad or surprise.', tech: 'CNN · 4 conv blocks · FER2013' },
      { title: 'Hear the tone', text: 'A second model listens to how things were said: pitch, energy and rhythm.', tech: 'Trained on RAVDESS' },
      { title: 'Read the words', text: 'The speech is transcribed and its sentiment scored.', tech: 'Text sentiment' },
      { title: 'One verdict', text: 'The three readings are reconciled into a single emotion.', tech: 'Fusion' },
    ],
    did: [
      'Built the face channel end to end: loading the data, the network (128 → 256 → 512 → 512 filters), training it for 100 epochs and testing it on faces it had not seen.',
      'Connected the model to a live camera: find the face, crop, normalise, predict, and label it on screen.',
      'Worked with the team to bring face, voice and text together into one result.',
    ],
    decisions: [
      { q: 'Why three signals?', a: 'Each one fails in a different way: faces in bad light, voices in noise, words when someone is sarcastic. Combined, the answer is much harder to fool.' },
      { q: 'How did you keep the face model from memorising faces?', a: 'Heavy dropout (0.3 – 0.4) after every block. A deep network on small 48 × 48 faces starts memorising the training set quickly without it.' },
    ],
    results: [
      { v: '3', k: 'signals fused', note: 'face, voice and words, read together' },
      { v: '7', k: 'emotions', note: 'angry, disgust, fear, happy, neutral, sad, surprise' },
      { v: '28,821', k: 'training faces', note: 'the face model learned from scratch on FER2013' },
    ],
    stack: [
      { k: 'Model', v: ['TensorFlow / Keras', 'CNN'] },
      { k: 'Vision', v: ['OpenCV', 'Haar cascades'] },
      { k: 'Data', v: ['FER2013', 'RAVDESS'] },
      { k: 'Language', v: ['Python', 'Jupyter'] },
    ],
  },
  {
    oneLiner: 'The “sell your item” flow for a second-hand marketplace, where every category’s questions live in the database, so adding a new category takes no code at all.',
    team: 'Solo build · live on Vercel',
    problem:
      'A phone needs “RAM? Battery health?”, a sofa needs “Seats? Material?”, and marketplaces add categories every week. If every category has a hand-written form, engineers write forms forever, and the form, the server’s checks and any AI slowly drift out of step.',
    flow: [
      { title: 'Seller starts a listing', text: 'They pick a category, or just speak a description. Gemini transcribes it, Hinglish included, and fills in the form.', tech: 'Gemini audio' },
      { title: 'Questions come from the database', text: 'Each category’s questions, their order and rules (“warranty expiry only if under warranty”) are rows in the database, not code.', tech: 'Postgres · Prisma' },
      { title: 'One form draws them all', text: 'A single generic form renders 9 kinds of input for any category. There are no hand-written forms.', tech: 'React Hook Form' },
      { title: 'Same rules in browser and server', text: 'Validation is generated from the same rows, once in the browser and again on the server. Skipping the browser gets the listing rejected.', tech: 'Zod · HTTP 422' },
      { title: 'The AI speaks the same rows', text: 'For a brand-new category Gemini drafts about 12 questions for an admin to approve, and its answers are forced to match the real options.', tech: 'Gemini · constrained output' },
      { title: 'The listing goes live', text: 'Pending → incomplete → live: nothing publishes with required questions unanswered, and the seller gets a to-do list.', tech: 'Listing lifecycle' },
    ],
    did: [
      'Designed the data model: categories, one shared pool of questions, and each category’s order and rules.',
      'Built the generic form engine, validation on both sides, product pages, the home page and the admin panel.',
      'Added AI question drafting, voice listing and the seller-proposed “Others” category, approved by an admin.',
      'Made it resilient: a fallback chain of AI models when one is rate-limited, and full manual use without an AI key.',
      'Deployed it live on Vercel with a Neon Postgres database.',
    ],
    decisions: [
      { q: 'Why keep the questions in the database?', a: 'Adding a category becomes data entry instead of a code change, and the form, the validation and the AI cannot drift apart, because they all read the same rows.' },
      { q: 'Why validate twice?', a: 'The browser check is for the seller’s convenience, the server check is for safety. Both are generated from the same rows, so they always agree.' },
      { q: 'Why constrain the AI?', a: 'A free-text answer like “8gb” breaks the filters. Each dropdown’s options become the only values the AI may choose, so it can only pick a real one.' },
    ],
    results: [
      { v: '0', k: 'code per new category', note: 'a new shelf is added from the admin panel' },
      { v: '9', k: 'input types, one form', note: 'text, number, select, radio, checkbox, multi-select, date and more' },
      { v: '3', k: 'AI model fallbacks', note: 'listing keeps working when one model is rate-limited' },
    ],
    stack: [
      { k: 'Frontend', v: ['Next.js 16', 'React Hook Form', 'Tailwind', 'Motion'] },
      { k: 'Backend', v: ['PostgreSQL', 'Prisma 7', 'Zod'] },
      { k: 'AI', v: ['Gemini Flash (text + audio)'] },
      { k: 'Hosting', v: ['Vercel', 'Neon'] },
    ],
  },
  {
    oneLiner: 'An Android app that turns your bank’s SMS alerts into an expense tracker automatically, without ever touching the internet.',
    team: 'Solo build · Android',
    problem:
      'Tracking spending by hand is tedious, and most people give up. The apps that do it automatically usually want your bank login, or upload your data to their servers.',
    flow: [
      { title: 'The bank texts you', text: 'After a UPI payment, card swipe or transfer, your bank sends an SMS.', tech: 'Bank SMS' },
      { title: 'Read in the background', text: 'A native Android component catches the message, even when the app is closed.', tech: 'Kotlin receiver' },
      { title: 'Is it really the bank?', text: 'Only messages from registered bank sender IDs (like HDFCBK) are read. An ordinary phone number cannot fake those.', tech: 'DLT sender IDs' },
      { title: 'Pull out the facts', text: 'A parser extracts the amount, payee, account, channel and reference. OTPs, promotions and failed payments are ignored.', tech: 'Parser · 37 unit tests' },
      { title: 'File it in two taps', text: 'A notification asks: all mine, or split ÷2 ÷3 ÷4, plus a category, without opening the app.', tech: 'Quick sheet' },
      { title: 'Charts update', text: 'Everything lands in one database on the phone, and Home and Analytics refresh at once.', tech: 'SQLite · React Native' },
    ],
    did: [
      'Designed and built the whole app: the native Kotlin module and the React Native screens.',
      'Wrote the parsers for 5 banks from real messages, each pinned by unit tests on anonymised samples.',
      'Made duplicates impossible: every transaction is keyed on the bank’s reference number.',
      'Added auto-filing: file a payee the same way twice and it files itself from then on.',
      'Locked down privacy: no internet permission in the release build, and no cloud backup.',
    ],
    decisions: [
      { q: 'Why no backend at all?', a: 'Bank messages are sensitive. Without the internet permission, Android itself blocks every connection, so the data provably never leaves the phone.' },
      { q: 'Why one database writer?', a: 'The native side has to write while the app is closed. Two libraries writing to one SQLite file risks corrupting it, so the screens only read, through one query call.' },
      { q: 'How can you trust the parser?', a: 'Every bank format was written from real messages and is covered by unit tests, so a change can never silently break a bank.' },
    ],
    results: [
      { v: '5', k: 'banks parsed', note: 'ICICI, HDFC, Kotak, Union Bank, IDFC FIRST' },
      { v: '37', k: 'parser tests', note: 'run on the JVM against anonymised real messages' },
      { v: '0', k: 'network access', note: 'the release build cannot connect to anything' },
    ],
    stack: [
      { k: 'Mobile', v: ['React Native', 'Expo', 'TypeScript'] },
      { k: 'Native', v: ['Kotlin', 'Android SMS receiver', 'Notifications'] },
      { k: 'Data', v: ['SQLite', 'CSV export'] },
    ],
  },
]
