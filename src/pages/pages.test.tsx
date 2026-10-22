import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HomePage } from './HomePage'
import { CreateRoomPage } from './CreateRoomPage'
import { JoinRoomPage } from './JoinRoomPage'
import { categories } from '../data/categories'

describe('page entry points', () => {
  it('links the homepage to both room flows', () => {
    const html = renderToStaticMarkup(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(html).toContain('href="/host"')
    expect(html).toContain('href="/join"')
    expect(html).toContain('id="how-to-play"')
  })
  it('offers every mock category and initially disables submission', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomPage /></MemoryRouter>)
    for (const category of categories) expect(html).toContain(category.name)
    expect(html.match(/type="checkbox"/g)).toHaveLength(categories.length)
    expect(html).toContain('disabled=""')
  })
  it('prefills an invitation code and labels both form inputs', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/join?code=abc123']}><JoinRoomPage /></MemoryRouter>)
    expect(html).toContain('value="ABC123"')
    expect(html).toContain('for="room-code"')
    expect(html).toContain('for="nickname"')
    expect(html).toContain('尚未連線至真實房間')
  })
})
