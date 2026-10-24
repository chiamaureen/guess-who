import type { GameQuestion } from '../types/game-engine'

type Credit = NonNullable<GameQuestion['attribution']>

export function ImageCredits({ credit }: { credit: Credit }) {
  let details: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(credit.text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).format === 'guess-who-image-rights-v1') details = parsed as Record<string, unknown>
  } catch {}
  const text = (key: string) => typeof details[key] === 'string' ? details[key] as string : ''
  const safeLink = (value: string, hosts: string[]) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.href : ''
    } catch { return '' }
  }
  const license = safeLink(text('licenseUrl'), ['creativecommons.org'])
  const derivativeLicense = safeLink(text('derivativeLicenseUrl'), ['creativecommons.org'])
  const evidence = safeLink(text('evidenceUrl'), ['commons.wikimedia.org'])
  const source = safeLink(credit.source, ['commons.wikimedia.org'])
  return (
    <details className="image-credits">
      <summary>圖片來源與授權</summary>
      <p>{credit.author} · {credit.license}</p>
      <p>{text('attribution') || credit.text}</p>
      {text('modifications') && <p>圖片處理：{text('modifications')}</p>}
      {text('originalNotices') && <p>原始聲明：{text('originalNotices')}</p>}
      {text('checkedAt') && <p>證據查證日期：{text('checkedAt')}</p>}
      <p>
        {source && <a href={source} target="_blank" rel="noopener noreferrer">原始圖片來源</a>}{' '}
        {license && <a href={license} target="_blank" rel="noopener noreferrer">授權條款 {text('licenseVersion')}</a>}{' '}
        {derivativeLicense && <a href={derivativeLicense} target="_blank" rel="noopener noreferrer">處理後圖片沿用授權</a>}{' '}
        {evidence && <a href={evidence} target="_blank" rel="noopener noreferrer">授權證據</a>}
      </p>
    </details>
  )
}
