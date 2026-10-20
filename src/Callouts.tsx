import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { anchorNow, carRig } from './Car'
import { view } from './Scene'
import { ANCHOR_LABEL, type Anchor } from './content'

/**
 * Leader lines from the detail block to the part of the car it is about, like a technical drawing.
 * The anchor is a point on the bodywork, projected every frame, so the line stays on the car while it turns.
 */
export function Callouts() {
  const path = useRef<SVGPathElement>(null)
  const dot = useRef<SVGGElement>(null)
  const label = useRef<SVGTextElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const v = new THREE.Vector3()
    let raf = 0
    let key = ''
    let born = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const cards = document.querySelectorAll<HTMLElement>('.card[data-callout]')
      const card = cards[cards.length - 1]
      const cam = view.camera
      const name = card?.dataset.callout as Anchor | undefined
      const a = name && carRig.anchors[name]
      const burning = document.body.classList.contains('burning')
      if (!card || !cam || !a || !carRig.root || burning) { svg.current!.style.opacity = '0'; key = ''; return }
      // wait until the block has launched and landed before drawing the line
      if (parseFloat(getComputedStyle(card).opacity) < 0.95) { svg.current!.style.opacity = '0'; key = ''; return }
      const k = name + '|' + card.getAttribute('aria-label')
      if (k !== key) { key = k; born = now; if (label.current) label.current.textContent = ANCHOR_LABEL[name].toUpperCase() }
      anchorNow(name, v).applyMatrix4(carRig.root.matrixWorld).project(cam)
      if (v.z > 1) { svg.current!.style.opacity = '0'; return }
      const x = (v.x * 0.5 + 0.5) * innerWidth
      const y = (-v.y * 0.5 + 0.5) * innerHeight
      const r = card.getBoundingClientRect()
      // leave from the side of the block that faces the part: its top edge when the part is above it (the
      // lower-third), else its right edge level with its header; run out straight, then angle to the part
      let d: string
      if (y < r.top - 20) {
        const sx = Math.min(r.right - 24, Math.max(r.left + 24, x))
        const sy = r.top
        const ey = sy - Math.min(48, Math.max(20, (sy - y) * 0.2))
        d = `M${sx} ${sy} V${ey} L${x} ${y}`
      } else {
        const sx = r.right
        const sy = r.top + 26
        const ex = sx + Math.min(56, Math.max(24, (x - sx) * 0.18))
        d = `M${sx} ${sy} H${ex} L${x} ${y}`
      }
      const p = path.current!
      p.setAttribute('d', d)
      const len = p.getTotalLength()
      // draws on once the block has opened, then holds
      const t = Math.min(1, Math.max(0, (now - born - 250) / 650))
      const e = 1 - Math.pow(1 - t, 3)
      p.style.strokeDasharray = `${len}`
      p.style.strokeDashoffset = `${len * (1 - e)}`
      dot.current!.setAttribute('transform', `translate(${x} ${y})`)
      dot.current!.style.opacity = String(Math.max(0, (t - 0.85) / 0.15))
      label.current!.setAttribute('x', String(x + 12))
      label.current!.setAttribute('y', String(y - 12))
      label.current!.style.opacity = dot.current!.style.opacity
      svg.current!.style.opacity = '1'
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <svg className="callouts" ref={svg} aria-hidden="true">
      <path ref={path} className="co-line" />
      <g ref={dot}>
        <circle className="co-ring" r="9" />
        <circle className="co-dot" r="3.2" />
      </g>
      <text ref={label} className="co-label" />
    </svg>
  )
}
