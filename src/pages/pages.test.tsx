import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HomePage } from './HomePage'
import { CreateRoomPage } from './CreateRoomPage'
import { JoinRoomPage } from './JoinRoomPage'
import { ArrowUpRight } from '../components/ArrowUpRight'

describe('page entry points', () => {
  it('links the homepage to both room flows', () => {
    const html = renderToStaticMarkup(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(html).toContain('href="/host"')
    expect(html).toContain('href="/join"')
    expect(html).toContain('id="how-to-play"')
  })
  it('renders both homepage room links without magnetic or hover animation hooks', () => {
    const html = renderToStaticMarkup(<MemoryRouter><HomePage /></MemoryRouter>)
    const actions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)?.[1]
    expect(actions).toBeDefined()
    expect(actions?.match(/button-static/g)).toHaveLength(2)
    expect(actions).toContain('href="/host"')
    expect(actions).toContain('href="/join"')
    expect(actions).toContain(renderToStaticMarkup(<ArrowUpRight />))
    expect(actions).not.toContain('\u2197')
    expect(actions).not.toContain('magnetic')
  })
  it('loads genuine categories asynchronously without hardcoded or mock fallback categories', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomPage /></MemoryRouter>)
    expect(html).toContain('正在讀取分類')
    expect(html).not.toContain('type="checkbox"')
    expect(html).toContain('disabled=""')
  })
  it('prefills an invitation code and labels both form inputs', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/join?code=abc123']}><JoinRoomPage /></MemoryRouter>)
    expect(html).toContain('value="ABC123"')
    expect(html).toContain('for="room-code"')
    expect(html).toContain('for="nickname"')
    expect(html).toContain('Session 保存在此瀏覽器')
  })
})
