import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ArrowUpRight } from './ArrowUpRight'
import { MagneticButton } from './MagneticButton'
import { Portraits } from './Portraits'
import { Layout } from './Layout'
import { HomePage } from '../pages/HomePage'

describe('text-presentation up-right arrows', () => {
  it('renders the exact arrow and VS15 code points without changing fonts', () => {
    const markup = renderToStaticMarkup(<ArrowUpRight />)
    const text = markup.replace(/<[^>]*>/g, '')
    expect(Array.from(text, character => character.codePointAt(0))).toEqual([0x2197, 0xfe0e])
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('not-italic')
    expect(markup).not.toContain('font-family')
    expect(markup).not.toContain('\uFE0F')
  })
  it('keeps the existing icon prop and appends the text presentation selector', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="↗">建立房間</MagneticButton>)
    expect(markup).toContain('建立房間')
    expect(markup).toContain('\u2197\uFE0E')
    expect(markup).not.toMatch(/\u2197(?!\uFE0E)/u)
  })
  it('does not change other magnetic button icons', () => {
    const markup = renderToStaticMarkup(<MagneticButton icon="→">加入房間</MagneticButton>)
    expect(markup).toContain('→')
    expect(markup).not.toContain('<svg')
  })
  it('uses VS15 on every up-right arrow in the homepage, header, footer, and portrait cards', () => {
    for (const element of [<MemoryRouter><HomePage /></MemoryRouter>, <MemoryRouter><Layout /></MemoryRouter>, <Portraits />]) {
      const markup = renderToStaticMarkup(element)
      expect(markup).toContain('\u2197\uFE0E')
      expect(markup).not.toMatch(/\u2197(?!\uFE0E)/u)
      expect(markup).not.toContain('\u2197\uFE0F')
    }
  })
})
