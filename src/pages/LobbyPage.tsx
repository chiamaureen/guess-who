import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Feedback } from '../components/Feedback'
import { useAction } from '../hooks/useAction'
import { invitationUrl, RoomApiError } from '../lib/room-api'
import { roomService } from '../services/rooms'
import type { LobbyState } from '../types/game'
import { JoinRoomPage } from './JoinRoomPage'
import { GamePanel } from '../components/GamePanel'
import { useRoomSync } from '../hooks/useRoomSync'
import type { RoomSnapshot } from '../types/realtime'
import { ArrowUpRight } from '../components/ArrowUpRight'

export function LobbyPage() {
  const { roomCode = '' } = useParams()
  const code = roomCode.toUpperCase()
  const [state, setState] = useState<LobbyState | null>(null)
  const [mode, setMode] = useState<'loading' | 'join' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [cooldown, setCooldown] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReset, setConfirmReset] = useState('')
  const action = useAction()
  const navigate = useNavigate()
  const location = useLocation()
  const updateSnapshot = useCallback((snapshot: RoomSnapshot) => setState(snapshot.lobby), [])
  const sync = useRoomSync(code, mode === 'ready', updateSnapshot)
  useEffect(() => {
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    setMode('loading'); setLoadError('')
    const load = async () => {
      try {
        if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('房間代碼格式錯誤。')
        if (!roomService.hasSession(code)) { if (active) setMode('join'); return }
        const result = await roomService.getState(code)
        if (active) { setState(result); setMode('ready') }
      } catch (cause) {
        if (!active) return
        setLoadError(cause instanceof Error ? cause.message : '無法恢復房間。')
        if (cause instanceof RoomApiError && (cause.status === 429 || cause.status === 0 || cause.status >= 500)) retry = setTimeout(() => { void load() }, cause.status === 429 ? cause.retryAfter * 1000 + 250 : Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)))
        else setMode('error')
      }
    }
    void load()
    return () => { active = false; clearTimeout(retry) }
  }, [code, revision, location.key])
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(false), 5000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  if (mode === 'join') return <JoinRoomPage key={code} invitationCode={code} />
  if (mode === 'loading') return <section className="inner-page"><p role="status">正在驗證身分與恢復房間…</p>{loadError && <p role="status">{loadError} 將自動重試，請保留此頁。</p>}</section>
  if (mode === 'error' || !state) return <section className="inner-page"><h1>暫時無法進入房間</h1><Feedback error={loadError} message="" /><div className="lobby-actions"><button className="button button-primary button-static" onClick={() => setRevision(value => value + 1)}>重新驗證</button><Link className="button button-outline button-static" to="/join">返回加入房間</Link><button className="text-button" onClick={() => { void action.run(async () => { await roomService.forgetRoom(code); setRevision(value => value + 1); return ''; }); }}>清除此房間的本機 Session</button></div><Feedback error={action.error} message={action.message} /></section>
  const host = state.viewer.role === 'host'
  const waiting = state.room.status === 'waiting'
  const nickname = state.players.find(player => player.id === state.viewer.id)?.nickname
  const invite = invitationUrl(state.room.code, import.meta.env.BASE_URL, window.location.origin)
  return <section className="inner-page lobby-page">
    <Link className="back-link" to="/">← 回到首頁（保留 Session）</Link>
    <p className="eyebrow">( {host ? 'your room, your people' : 'your seat is ready'} )</p>
    <h1>{waiting ? host ? '朋友，快來集合！' : `${nickname ?? '你'}，入座囉！` : state.room.status === 'playing' ? '一起猜猜看！' : '房間已結束'}</h1>
    <div className="lobby-meta"><span className={`room-badge ${waiting ? 'waiting' : ''}`}>{waiting ? '等待中' : state.room.status === 'finished' ? '已關閉' : '遊戲進行中'}</span><span>每場 15 題</span><span>到期：{new Date(state.room.expiresAt).toLocaleString('zh-TW')}</span></div>
    {!waiting && <p className="feedback" role="status">{state.room.status === 'finished' ? '主持人已關閉房間，不能再加入。' : '遊戲進行中，題目將自動同步。'}</p>}
    <p className="form-note" role="status" data-sync-status={sync.status}>{sync.message}</p>
    <div className="lobby-grid">
      <div className="lobby-panel lobby-info"><p className="form-kicker">( room code )</p><strong className="lobby-code" aria-label={`房間代碼 ${state.room.code}`}>{state.room.code}</strong>
        {host && <><label htmlFor="invitation-link">玩家邀請連結</label><input id="invitation-link" readOnly value={invite} onFocus={event => event.target.select()} /><button type="button" className="button button-outline button-static" disabled={!waiting || action.loading} onClick={() => { void action.run(async () => { try { await navigator.clipboard.writeText(invite); return '邀請連結已複製。' } catch { throw new Error('無法自動複製，請選取上方連結手動複製。') } }); }}>複製邀請連結 <ArrowUpRight /></button></>}
        <h2>已選分類</h2><ul className="category-tags">{state.categories.map(category => <li key={category.id}>{category.name}</li>)}</ul>
        {!host && <p className="lobby-waiting">{waiting ? '等待主持人開始遊戲' : state.room.status === 'playing' ? '一起猜猜看！' : '感謝加入，一起期待下一場。'}<small>主持人的遊戲操作將自動同步。</small></p>}
      </div>
      <div className="lobby-panel"><div className="player-list-heading"><h2>玩家名單 <span>({state.players.length})</span></h2><button type="button" className="text-button" disabled={action.loading || cooldown} onClick={() => { setCooldown(true); sync.refresh() }}>{cooldown ? '請稍候 5 秒' : '重新整理名單'}</button></div>
        {state.players.length ? <ul className="player-list">{state.players.map((player, index) => <li key={player.id}><span className="player-avatar" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{player.nickname}</strong>{player.id === state.viewer.id && <span className="self-label">你</span>}</li>)}</ul> : <p className="empty-players">還沒有玩家，分享邀請連結，讓朋友入座吧！</p>}
        <p className="form-note">等待室名單會定期自動更新。重新整理會重新驗證身分並恢復同步；遊戲中的名單保留開場快照。</p>
      </div>
    </div>
    {state.room.status !== 'finished' && <GamePanel key={code} code={code} roomStatus={state.room.status} state={sync.snapshot?.game ?? null} onRefresh={sync.refresh}
      onControl={(operation, questionId) => sync.mutate(() => roomService.controlSnapshot(code, operation, questionId))}
      onReset={revision => sync.mutate(async () => { await roomService.resetHistory(code, revision, true); return roomService.getSnapshot(code) })} />}
    <Feedback error={action.error} message={action.message} />
    {host && state.room.status === 'finished' && sync.snapshot?.game.historyRevision && <div className="identity-settings">
      <p>跨場歷史已保留；若可用人物不足，可以明確重置自己的歷史，不刪除已完成題目。</p>
      {!confirmReset ? <button type="button" className="text-button" onClick={() => setConfirmReset(sync.snapshot!.game.historyRevision!)}>重置我的出題歷史</button> : <>
        <p>確定讓自己已使用過的人物重新進入抽題池？其他主持人的歷史不受影響。</p>
        <button type="button" className="button button-outline button-static" disabled={action.loading} onClick={() => { void action.run(async () => { await sync.mutate(async () => { await roomService.resetHistory(code,confirmReset,true); return roomService.getSnapshot(code) }); setConfirmReset(''); return '你的出題歷史已重置。'; }); }}>確認重置我的歷史</button>
        <button type="button" className="text-button" disabled={action.loading} onClick={() => setConfirmReset('')}>取消重置</button>
      </>}
    </div>}
    <div className="lobby-actions">
      {host && waiting && (!confirmClose ? <button className="text-button danger" disabled={action.loading} onClick={() => setConfirmClose(true)}>關閉房間</button> : <><p>確定關閉？玩家將無法再加入。</p><button className="button button-outline button-static" disabled={action.loading} onClick={() => { void action.run(async () => { await sync.mutate(async () => { await roomService.close(code); return roomService.getSnapshot(code) }); setConfirmClose(false); return '房間已關閉。'; }); }}>確認關閉房間</button><button className="text-button" onClick={() => setConfirmClose(false)}>取消</button></>)}
      {!host && <button className="button button-outline button-static" disabled={action.loading} onClick={() => { void action.run(async () => { await roomService.leave(code); void navigate('/join', { replace: true }); return ''; }); }}>離開房間 →</button>}
    </div>
  </section>
}
