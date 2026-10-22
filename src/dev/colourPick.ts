// Dev only (?colourpick): a small panel that repaints the car live in any colour, in the matte finish, so the
// owner can find the body colour by eye and read off its hex. Uses the car's __tryColour hook (Car.tsx).

type W = Window & { __tryColour?: (hex: string) => void }

const hsl = (h: number, s: number, l: number) => {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

async function mount() {
  while (!(window as W).__tryColour) await new Promise((r) => setTimeout(r, 300))
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;z-index:99;right:16px;bottom:16px;width:280px;padding:14px 16px;background:rgba(12,12,13,0.92);border:1px solid rgba(237,235,230,0.18);font:12px "JetBrains Mono",monospace;color:#edebe6;display:grid;gap:10px;cursor:default'
  box.innerHTML = `
    <b style="font:600 13px Archivo,sans-serif;letter-spacing:.02em">Body colour (matte)</b>
    <label style="display:grid;gap:4px">Hue <input data-k="h" type="range" min="0" max="360" value="20"></label>
    <label style="display:grid;gap:4px">Saturation <input data-k="s" type="range" min="0" max="100" value="45"></label>
    <label style="display:grid;gap:4px">Lightness <input data-k="l" type="range" min="5" max="90" value="55"></label>
    <div style="display:flex;gap:8px;align-items:center">
      <input data-k="pick" type="color" value="#b7735a" style="width:44px;height:28px;border:0;background:none;padding:0">
      <input data-k="hex" value="#b7735a" style="flex:1;background:#000;color:#edebe6;border:1px solid rgba(237,235,230,.2);padding:5px 8px;font:inherit">
      <button data-k="copy" style="background:#edebe6;color:#0b0b0c;border:0;padding:6px 10px;font:inherit;cursor:pointer">Copy</button>
    </div>
    <span style="color:#a4a29c">Drag the sliders or pick a colour; the car repaints. Send the hex you like.</span>`
  document.body.appendChild(box)
  const q = (k: string) => box.querySelector(`[data-k="${k}"]`) as HTMLInputElement
  let t: ReturnType<typeof setTimeout> | null = null, want = ''
  const paint = (hex: string, from: 'sliders' | 'hex') => {
    q('hex').value = hex
    q('pick').value = hex
    if (from !== 'sliders') {
      // keep the sliders in step with a typed or picked colour
      const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
      const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
      const h = !d ? 0 : mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
      q('h').value = String(Math.round((h + 360) % 360)); q('s').value = String(Math.round(s * 100)); q('l').value = String(Math.round(l * 100))
    }
    // repainting the 4096 atlas takes a moment: at most a few times a second while dragging
    want = hex
    if (!t) t = setTimeout(() => { t = null; (window as W).__tryColour!(want) }, 120)
  }
  const fromSliders = () => paint(hsl(+q('h').value, +q('s').value, +q('l').value), 'sliders')
  for (const k of ['h', 's', 'l']) q(k).addEventListener('input', fromSliders)
  q('pick').addEventListener('input', () => paint(q('pick').value, 'hex'))
  q('hex').addEventListener('change', () => { const v = q('hex').value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) paint(v.toLowerCase(), 'hex') })
  q('copy').addEventListener('click', () => { void navigator.clipboard?.writeText(q('hex').value); q('copy').textContent = 'Copied'; setTimeout(() => (q('copy').textContent = 'Copy'), 1200) })
  // the panel is for the mouse, not for the page's drag-to-turn
  for (const ev of ['pointerdown', 'wheel', 'keydown']) box.addEventListener(ev, (e) => e.stopPropagation())
  paint(q('hex').value, 'hex')
}

mount()
