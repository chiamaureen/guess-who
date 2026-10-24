import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ArrowUpRight } from './ArrowUpRight'
import { MagneticButton } from './MagneticButton'
import { Portraits } from './Portraits'
import { Layout } from './Layout'

describe('font-independent up-right arrows', () => {
  it('renders a decorative SVG with inherited color and size instead of emoji text', () => {
    const markup = renderToStaticMarkup(<ArrowUpRight />)
    expect(markup).toContain('<svg')
    expect(markup).toContain('stroke="currentColor"')
    expect(markup).toContain('width="1em" height="1em"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('focusable="false"')
    expect(markup).not.toContain('↗')
  })
  it('keeps the existing magnetic button icon prop while rendering up-right arrows as SVG', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="↗">建立房間</MagneticButton>)
    expect(markup).toContain('建立房間')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('↗')
  })
  it('does not change other magnetic button icons', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="→">加入房間</MagneticButton>)
    expect(markup).toContain('→')
    expect(markup).not.toContain('<svg')
  })
  it('uses SVG arrows in the header, footer, and portrait cards', () => {
    for (const element of [<MemoryRouter><Layout /></MemoryRouter>, <Portraits />]) {
      const markup = renderToStaticMarkup(element)
      expect(markup).toContain('M7 17 17 7M7 7h10v10')
      expect(markup).not.toContain('↗')
    }
  })
})
