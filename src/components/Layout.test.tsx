import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Layout } from './Layout'

describe('header navigation', () => {
  it.each([
    ['/', '首頁', 'page'],
    ['/#how-to-play', '怎麼玩？', 'location'],
    ['/host', '', ''],
    ['/host#how-to-play', '', ''],
  ])('marks the correct link at %s', (location, label, current) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[location]}><Layout /></MemoryRouter>)
    const activeLinks = [...html.matchAll(/<a\b[^>]*class="active"[^>]*>([^<]*)<\/a>/g)]

    expect(activeLinks).toHaveLength(label ? 1 : 0)
    if (label) {
      expect(activeLinks[0][1]).toBe(label)
      expect(activeLinks[0][0]).toContain(`aria-current="${current}"`)
    }
  })
})
