import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImageCredits } from './ImageCredits'
import { GamePanel } from './GamePanel'
import type { GameState } from '../types/game-engine'

const credit = {
  author: 'Synthetic photographer', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:SECRET_NAME.jpg',
  text: JSON.stringify({ format: 'guess-who-image-rights-v1', author: 'Synthetic photographer', attribution: 'Author credit', licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', derivativeLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modifications: 'WebP resize; metadata removed', originalNotices: 'Original synthetic notices', checkedAt: '2026-10-24', evidenceUrl: 'https://commons.wikimedia.org/w/index.php?oldid=123' }),
}
const state = (role: 'host' | 'player', revealed: boolean): GameState => ({
  viewer: { role, id: 'fixture' }, room: { id: 'fixture', code: 'ABC123', status: 'playing', currentQuestion: 1, totalQuestions: 15, expiresAt: '2099-01-01T00:00:00Z' },
  question: { id: 'fixture', number: 1, revealed, ...(role === 'host' || revealed ? { answer: 'SECRET_NAME', attribution: credit } : {}) },
})

describe('private image licensing presentation', () => {
  it('provides author, original page, version, modifications, retained notices, terms, SA license and evidence links', () => {
    const markup = renderToStaticMarkup(<ImageCredits credit={credit} />)
    for (const value of ['Synthetic photographer', 'CC BY-SA 4.0', 'WebP resize', 'Original synthetic notices', '圖片來源與授權', '原始圖片來源', '授權條款 4.0', '處理後圖片沿用授權', '授權證據']) expect(markup).toContain(value)
    expect(markup).toContain('https://creativecommons.org/licenses/by-sa/4.0/')
  })
  it('retains old plain-text credits and never injects untrusted HTML or unsafe links', () => {
    const markup = renderToStaticMarkup(<ImageCredits credit={{ author: '<script>bad</script>', license: 'CC0', source: 'javascript:bad()', text: 'Legacy attribution' }} />)
    expect(markup).toContain('Legacy attribution')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('href=')
  })
  it('shows no name, source or licensing payload to unrevealed Player, but Host and revealed Player can inspect it', () => {
    for (const [role, revealed] of [['host', false], ['player', false], ['player', true]] as const) {
      const markup = renderToStaticMarkup(<GamePanel code="ABC123" roomStatus="playing" state={state(role, revealed)} onRefresh={() => {}} onControl={async () => {}} onReset={async () => {}} />)
      expect(markup.includes('SECRET_NAME')).toBe(role === 'host' || revealed)
      expect(markup.includes('commons.wikimedia.org')).toBe(role === 'host' || revealed)
    }
  })
})
