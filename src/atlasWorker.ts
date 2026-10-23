import { ATLAS_H, ATLAS_W, LIVERIES, paintAtlas } from './liveries'
import { SPONSOR_SETS } from './sponsors'

// Paints a livery atlas off the main thread. A 4096 canvas of gradients and some four thousand letters takes a
// fifth of a second to rasterise; done on the page it froze a frame at every pit stop. Here it is drawn on an
// OffscreenCanvas and handed back as a finished bitmap, which the page only has to upload.

// the same faces the page uses, loaded into the worker (it has no access to the page's fonts)
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=JetBrains+Mono:wght@400;500&display=swap'
type Fonts = { add: (f: FontFace) => void }
let fonts: Promise<unknown> | null = null
async function loadFonts() {
  const css = await (await fetch(FONTS)).text()
  const loads: Promise<FontFace>[] = []
  for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const pick = (k: string) => new RegExp(k + ':\\s*([^;]+);').exec(body)?.[1].trim()
    const range = pick('unicode-range')
    // the Latin subset is all the lettering on the car needs
    if (range && !range.includes('U+0000-00FF')) continue
    const family = pick('font-family')?.replace(/['"]/g, '')
    const src = pick('src')
    if (!family || !src) continue
    const face = new FontFace(family, src, { style: pick('font-style'), weight: pick('font-weight'), stretch: pick('font-stretch'), unicodeRange: range })
    ;(self as unknown as { fonts: Fonts }).fonts.add(face)
    loads.push(face.load())
  }
  return Promise.all(loads)
}

let canvas: OffscreenCanvas | null = null
self.onmessage = async (e: MessageEvent<{ id: number; livery: string; set: string; size: { x: number; y: number; z: number } }>) => {
  const { id, livery, set, size } = e.data
  const reply = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)
  try {
    fonts ??= loadFonts().catch(() => null)
    await fonts
    const l = LIVERIES.find((x) => x.id === livery)
    const s = SPONSOR_SETS.find((x) => x.id === set)
    if (!l || !s) { reply({ id, error: true }); return }
    canvas ??= new OffscreenCanvas(ATLAS_W, ATLAS_H)
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D
    paintAtlas(ctx, l, s, size)
    // the raw pixels, handed over without a copy: the page uploads them to the GPU a strip at a time, which an
    // ImageBitmap can't do (every partial upload of one converts the whole bitmap)
    const px = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H).data.buffer
    reply({ id, px }, [px])
  } catch {
    reply({ id, error: true })
  }
}
