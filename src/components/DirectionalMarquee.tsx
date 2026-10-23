import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { Observer } from 'gsap/Observer'

gsap.registerPlugin(Observer)

const messages = ['Less scrolling. More guessing.', '看臉熟，猜名字。', 'Less scrolling. More guessing.']

export function DirectionalMarquee() {
  const trackRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = trackRef.current
    const group = groupRef.current
    if (!track || !group) return

    const media = gsap.matchMedia()
    media.add({
      motion: '(prefers-reduced-motion: no-preference)',
      desktop: '(min-width: 1025px)',
    }, context => {
      if (!context.conditions?.motion) return

      const loop = gsap.fromTo(track, { xPercent: 0 }, {
        xPercent: -50,
        duration: group.getBoundingClientRect().width / 100,
        ease: 'none',
        repeat: -1,
        onReverseComplete: () => {
          loop.totalTime(loop.rawTime() + loop.duration() * 100)
        },
      })
      let speedChange: gsap.core.Timeline | undefined

      const observer = context.conditions.desktop ? Observer.create({
        target: window,
        type: 'scroll',
        onChangeY: ({ deltaY }) => {
          if (!deltaY) return
          const direction = deltaY > 0 ? 1 : -1
          speedChange?.kill()
          speedChange = gsap.timeline()
            .to(loop, { timeScale: direction * 6.25, duration: 0.2, ease: 'none' })
            .to(loop, { timeScale: direction, duration: 1, ease: 'none' }, '+=0.3')
        },
      }) : undefined

      const resizeObserver = new ResizeObserver(() => {
        const width = group.getBoundingClientRect().width
        if (width > 0) loop.duration(width / 100)
      })
      resizeObserver.observe(group)

      return () => {
        observer?.kill()
        resizeObserver.disconnect()
        speedChange?.kill()
      }
    })

    return () => media.revert()
  }, [])

  return <div className="ticker" aria-hidden="true">
    <div className="ticker-track" ref={trackRef}>
      {[0, 1].map(copy => <div className="ticker-group" ref={copy === 0 ? groupRef : undefined} key={copy}>
        {messages.map((message, index) => <span key={index}>{message}</span>)}
      </div>)}
    </div>
  </div>
}
