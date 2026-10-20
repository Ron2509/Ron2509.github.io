import { useSyncExternalStore } from 'react'

// Live weather at the visitor's location drives the studio: rain on the lens, a wet mirror floor. The location
// is a city-level guess from the visitor's IP (geojs.io), the weather comes from Open-Meteo; neither needs a key.
// Nothing is stored beyond this browser session. If either lookup fails the studio stays dry.

export type Sky = 'clear' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow'
export type WeatherMode = 'live' | 'rain' | 'dry'

type Weather = {
  city: string
  temp: number | null
  sky: Sky
  /** rain falling where the visitor is, 0..1 */
  live: number
  mode: WeatherMode
  ready: boolean
}

let state: Weather = { city: '', temp: null, sky: 'clear', live: 0, mode: 'live', ready: false }
const listeners = new Set<() => void>()
const set = (p: Partial<Weather>) => { state = { ...state, ...p }; listeners.forEach((l) => l()) }

export const weather = {
  get: () => state,
  /** how wet the studio should be right now, 0..1 */
  wet: () => (state.mode === 'rain' ? 0.85 : state.mode === 'dry' ? 0 : state.live),
  setMode: (mode: WeatherMode) => set({ mode }),
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
}

export function useWeather() {
  return useSyncExternalStore(weather.subscribe, weather.get)
}

// WMO weather codes, as Open-Meteo reports them
function sky(code: number): Sky {
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 1 && code <= 3) return 'cloud'
  return 'clear'
}
const WET: Record<Sky, number> = { clear: 0, cloud: 0, fog: 0, snow: 0, drizzle: 0.4, rain: 0.75, storm: 1 }

export const SKY_LABEL: Record<Sky, string> = {
  clear: 'Clear', cloud: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow',
}

const KEY = 'wx-v1'

async function load() {
  // dev: ?weather=rain or ?weather=dry forces the studio
  const forced = new URLSearchParams(location.search).get('weather')
  if (forced === 'rain' || forced === 'dry') set({ mode: forced })
  try {
    const cached = sessionStorage.getItem(KEY)
    if (cached) {
      const c = JSON.parse(cached)
      if (Date.now() - c.at < 30 * 60e3) { set({ ...c.w, ready: true }); return }
    }
  } catch { /* storage may be blocked */ }
  try {
    const geo = await (await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: AbortSignal.timeout(6000) })).json()
    const lat = Number(geo.latitude), lon = Number(geo.longitude)
    if (!isFinite(lat) || !isFinite(lon)) throw new Error('no location')
    const q = `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,precipitation,weather_code`
    const met = await (await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(6000) })).json()
    const s = sky(Number(met.current?.weather_code ?? 0))
    const mm = Number(met.current?.precipitation ?? 0)
    // heavier rain, wetter studio
    const live = Math.min(1, WET[s] + Math.min(0.3, mm * 0.08))
    const w = { city: String(geo.city || geo.region || ''), temp: met.current?.temperature_2m ?? null, sky: s, live }
    set({ ...w, ready: true })
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), w })) } catch { /* fine */ }
  } catch {
    set({ ready: true })
  }
}

if (typeof window !== 'undefined') load()
