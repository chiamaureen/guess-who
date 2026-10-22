import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export function useMagnetic<Element extends HTMLElement>(disabled = false) {
  const zoneRef = useRef<Element>(null)

  useEffect(() => {
    const zone = zoneRef.current
    const target = zone?.querySelector<HTMLElement>('[data-magnetic-target]')
    const label = zone?.querySelector<HTMLElement>('[data-magnetic-label]')
    if (!zone || !target || disabled) return

    const targets = label ? [target, label] : [target]
    const media = gsap.matchMedia()
    media.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
      function move(event: PointerEvent) {
        if (event.pointerType !== 'mouse' || !zone || !target) return
        const bounds = zone.getBoundingClientRect()
        const offsetX = event.clientX - bounds.left - bounds.width / 2
        const offsetY = event.clientY - bounds.top - bounds.height / 2
        gsap.to(target, {
          x: gsap.utils.clamp(-24, 24, offsetX * 0.4),
          y: gsap.utils.clamp(-16, 16, offsetY * 0.4),
          duration: 0.4,
          ease: 'power2.out',
          overwrite: true,
        })
        if (label) gsap.to(label, {
          x: gsap.utils.clamp(-12, 12, offsetX * 0.24),
          y: gsap.utils.clamp(-8, 8, offsetY * 0.24),
          duration: 0.4,
          ease: 'power2.out',
          overwrite: true,
        })
      }

      function reset() {
        gsap.to(targets, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: true })
      }

      zone.addEventListener('pointermove', move)
      zone.addEventListener('pointerleave', reset)
      zone.addEventListener('pointercancel', reset)
      zone.addEventListener('focusin', reset)

      return () => {
        zone.removeEventListener('pointermove', move)
        zone.removeEventListener('pointerleave', reset)
        zone.removeEventListener('pointercancel', reset)
        zone.removeEventListener('focusin', reset)
        gsap.killTweensOf(targets)
        gsap.set(targets, { clearProps: 'transform' })
      }
    })

    return () => media.revert()
  }, [disabled])

  return zoneRef
}
