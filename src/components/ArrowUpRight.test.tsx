import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ArrowUpRight } from './ArrowUpRight'
import { MagneticButton } from './MagneticButton'
import { Portraits } from './Portraits'
import { Layout } from './Layout'
import { HomePage } from '../pages/HomePage'

describe('SVG up-right arrows', () => {
  it('renders a decorative vector arrow without emoji or font dependency', () => {
    const markup = renderToStaticMarkup(<ArrowUpRight />)
    const text = markup.replace(/<[^>]*>/g, '')
    expect(text).toBe('')
    expect(markup).toContain('<svg')
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup).toContain('stroke="currentColor"')
    expect(markup).toContain('d="M7 17 17 7M7 7h10v10"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('font-family')
    expect(markup).not.toContain('\uFE0F')
  })
  it('normalizes the existing up-right icon prop to the SVG component', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="↗">建立房間</MagneticButton>)
    expect(markup).toContain('建立房間')
    expect(markup).toContain(renderToStaticMarkup(<ArrowUpRight />))
    expect(markup).not.toContain('\u2197')
  })
  it('does not change other magnetic button icons', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="→">加入房間</MagneticButton>)
    expect(markup).toContain('→')
    expect(markup).not.toContain('<svg')
  })
  it('uses the vector arrow throughout the homepage, header, footer, and portrait cards', () => {
    for (const element of [<MemoryRouter><HomePage /></MemoryRouter>, <MemoryRouter><Layout /></MemoryRouter>, <Portraits />]) {
      const markup = renderToStaticMarkup(element)
      expect(markup).toContain(renderToStaticMarkup(<ArrowUpRight />))
      expect(markup).not.toContain('\u2197')
      expect(markup).not.toContain('\uFE0F')
    }
  })
})
