// Daily AI & tech wire for the pit-wall screens: headlines only, each linking to its source.
// Public RSS/Atom feeds from established publications and the AI labs' newsrooms, no scraping. Writes public/news.json. Keeps the previous file if every source fails.
//   node scripts/fetch-news.mjs        (npm run news; a scheduled GitHub Action runs it every morning)
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'news.json')
const UA = 'Mozilla/5.0 (portfolio pit-wall news; +https://github.com/Ron2509)'
const AI = /\b(ai|a\.i\.|llm|llms|gpt|openai|anthropic|claude|gemini|deepmind|mistral|llama|deepseek|qwen|model|models|agent|agents|agentic|inference|gpu|nvidia|transformer|neural|machine learning|ml|rag|robot|robotics|chip|chips|startup|copilot|hugging ?face)\b/i
// the wire is today's news: the last 36 hours, reaching back to 3 days only on a quiet news day
const FRESH_HOURS = 36
const QUIET_HOURS = 72
const ENOUGH = 10
// it's a portfolio: keep crime, adult and tabloid stories off the pit wall
const BLOCK = /\b(onlyfans|csam|porn\w*|sex|sexual\w*|nude\w*|abuse\w*|murder\w*|arrest\w*|pervert\w*|dirty|kill\w*|suicide|shooting)\b|pervert/i

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim()
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : '' }

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.text()
}

/** RSS 2.0 <item> or Atom <entry> */
async function feed(url, source) {
  const xml = await get(url)
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ?? b.match(/<link[^>]*href="([^"]+)"/i)?.[1]
    const link = tag(b, 'link') || atomLink || ''
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')
    return { title: tag(b, 'title'), url: link, source, time: when ? new Date(when).toISOString() : null }
  })
}

// Credible sources only: established publications and the AI labs' own newsrooms (no user-submitted
// aggregators). [name, feed, kind, filter to AI/tech?]
const SOURCES = [
  ['MIT Technology Review', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'press', false],
  ['The Guardian', 'https://www.theguardian.com/technology/artificialintelligenceai/rss', 'press', true],
  ['BBC News', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'press', true],
  ['Ars Technica', 'https://arstechnica.com/ai/feed/', 'press', false],
  ['Wired', 'https://www.wired.com/feed/tag/ai/latest/rss', 'press', false],
  ['TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'press', false],
  ['The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'press', false],
  ['The Economic Times', 'https://economictimes.indiatimes.com/tech/artificial-intelligence/rssfeeds/119215726.cms', 'press', false],
  ['OpenAI', 'https://openai.com/news/rss.xml', 'lab', false],
  ['Google DeepMind', 'https://deepmind.google/blog/rss.xml', 'lab', false],
  ['Google AI', 'https://blog.google/technology/ai/rss/', 'lab', false],
  ['NVIDIA', 'https://blogs.nvidia.com/feed/', 'lab', true],
  ['Hugging Face', 'https://huggingface.co/blog/feed.xml', 'lab', false],
]
const sources = SOURCES.map(([name, url, kind, filter]) => [name, async () => {
  const items = await feed(url, name)
  return items.filter((x) => !filter || AI.test(x.title)).map((x) => ({ ...x, kind }))
}])

const results = await Promise.allSettled(sources.map(([, f]) => f()))
const ok = []
results.forEach((r, i) => {
  if (r.status === 'fulfilled') { ok.push(sources[i][0]); console.log(`${sources[i][0]}: ${r.value.length}`) }
  else console.warn(`${sources[i][0]} failed: ${r.reason?.message ?? r.reason}`)
})
const pick = (hours) => {
  const fresh = Date.now() - hours * 36e5
  const seen = new Set()
  const per = {}
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    // undated items cannot prove they are fresh, so they are left out
    .filter((x) => x.title && /^https?:\/\//.test(x.url) && x.time && Date.parse(x.time) > fresh && !BLOCK.test(x.title))
    .filter((x) => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    // keep a mix: at most 3 from any one source
    .filter((x) => (per[x.source] = (per[x.source] ?? 0) + 1) <= 3)
    .slice(0, 28)
}
let items = pick(FRESH_HOURS)
if (items.length < ENOUGH) items = pick(QUIET_HOURS)

if (!items.length) {
  console.warn('No headlines fetched; keeping the existing news.json')
  process.exit(existsSync(OUT) ? 0 : 1)
}
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), sources: ok, items }, null, 2) + '\n')
console.log(`Wrote ${items.length} headlines → ${path.relative(process.cwd(), OUT)}`)
