import { useEffect, useState } from 'react'
import { roomService } from '../services/rooms'
import { useAction } from '../hooks/useAction'
import type { GameAction, GameState } from '../types/game-engine'
import type { LobbyState } from '../types/game'
import { Feedback } from './Feedback'

export function GamePanel({ code, roomStatus, onRoomChange }: { code: string; roomStatus: LobbyState['room']['status']; onRoomChange: (room: LobbyState['room']) => void }) {
  const [state, setState] = useState<GameState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [imageUrl, setImageUrl] = useState('')
  const [imageQuestionId, setImageQuestionId] = useState('')
  const [imageError, setImageError] = useState('')
  const [imageRevision, setImageRevision] = useState(0)
  const [confirmFinish, setConfirmFinish] = useState('')
  const [confirmReset, setConfirmReset] = useState('')
  const [refreshing, setRefreshing] = useState(true)
  const [cooldown, setCooldown] = useState(false)
  const action = useAction()
  useEffect(() => {
    let active = true
    setLoadError(''); setRefreshing(true)
    void roomService.getGameState(code).then(result => { if (active) { setState(result); onRoomChange(result.room) } }).catch(cause => { if (active) setLoadError(cause instanceof Error ? cause.message : '無法取得遊戲狀態。') }).finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [code, revision, onRoomChange])
  const questionId = state?.question?.id
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setImageUrl(''); setImageError('')
    if (questionId) void roomService.getGameImage(code, questionId).then(image => {
      if (!active) return
      objectUrl = URL.createObjectURL(image); setImageUrl(objectUrl); setImageQuestionId(questionId)
    }).catch(cause => { if (active) setImageError(cause instanceof Error ? cause.message : '圖片載入失敗。') })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [code, questionId, imageRevision])
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(false), 5000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  const apply = (result: GameState) => { setState(result); onRoomChange(result.room) }
  const control = (operation: GameAction, expectedQuestionId?: string) => { void action.run(async () => { apply(await roomService.controlGame(code, operation, operation === 'start-game' ? undefined : expectedQuestionId ?? state?.question?.id)); setConfirmFinish(''); setConfirmReset(''); return '' }) }
  const busy = action.loading || refreshing
  const host = state?.viewer.role === 'host'
  const playing = roomStatus === 'playing'
  const question = state?.question
  return <section className="game-panel lobby-panel" aria-label="遊戲區域">
    <div className="player-list-heading"><h2>猜猜我是誰 <span>{state ? `${state.room.currentQuestion}/15` : ''}</span></h2><button className="text-button" disabled={busy || cooldown} onClick={() => { setCooldown(true); setRevision(value => value + 1) }}>{cooldown ? '請稍候 5 秒' : '重新取得遊戲狀態'}</button></div>
    {loadError && <Feedback error={loadError} message="遊戲服務尚未部署時，原有等待室仍可使用。" />}
    {!state && !loadError && <p role="status">正在恢復遊戲狀態…</p>}
    {state && roomStatus === 'waiting' && <>{host ? <><p>準備好後開始。需要至少 15 位未使用、已審核且有安全圖片的人物。</p><button className="button button-primary button-static" disabled={busy} onClick={() => control('start-game')}>開始遊戲</button></> : <p>等待主持人開始遊戲，請手動更新狀態。</p>}</>}
    {question && <><p className="eyebrow">QUESTION {question.number} / 15 · {question.revealed ? '已揭曉' : '尚未揭曉'}</p><div className="game-photo">{imageUrl && imageQuestionId === questionId ? <img src={imageUrl} alt={`第 ${question.number} 題人物照片`} /> : <p role="status">{imageError || '正在載入照片…'}</p>}</div>
      {imageError && <button className="text-button" disabled={action.loading} onClick={() => setImageRevision(value => value + 1)}>重新載入圖片</button>}
      {question.answer ? <div className="game-answer"><p>{host && !question.revealed ? '主持人專屬答案・尚未向玩家揭曉' : '正確答案'}</p><h3>{question.answer}</h3>{question.attribution && <small>{question.attribution.author} · {question.attribution.license} · {question.attribution.text}{/^https:\/\//.test(question.attribution.source) && <> · <a href={question.attribution.source} target="_blank" rel="noopener noreferrer">圖片來源</a></>}</small>}</div> : <p className="game-answer" role="status">{playing ? '先口頭猜猜看，等待主持人揭曉答案。' : '本題未揭曉，遊戲已結束。'}</p>}
      {host && playing && <div className="lobby-actions"><button className="button button-primary button-static" disabled={busy || question.revealed} onClick={() => control('reveal-answer')}>揭曉答案</button><button className="button button-outline button-static" disabled={busy || !question.revealed || question.number === 15} onClick={() => control('next-question')}>下一題</button>
        {!confirmFinish ? <button className="text-button danger" disabled={busy} onClick={() => setConfirmFinish(question.id)}>{question.number === 15 && question.revealed ? '結束遊戲' : '提前結束遊戲'}</button> : <><p>確定結束？已使用的人物仍會保留在歷史。</p><button className="button button-outline button-static" disabled={busy} onClick={() => control('finish-game', confirmFinish)}>確認結束遊戲</button><button className="text-button" disabled={busy} onClick={() => setConfirmFinish('')}>取消</button></>}
      </div>}
    </>}
    {state && roomStatus === 'finished' && <p role="status">遊戲已結束，已出現人物保留在主持人的跨場歷史中。</p>}
    {host && !playing && state?.historyRevision && <div className="game-reset">{!confirmReset ? <button className="text-button" disabled={busy} onClick={() => setConfirmReset(state.historyRevision!)}>重置我的出題歷史</button> : <><p>只清除你的跨場去重紀錄，保留已完成題目。確定要讓舊人物再次出現嗎？</p><button className="button button-outline button-static" disabled={busy} onClick={() => { void action.run(async () => { await roomService.resetHistory(code, confirmReset, true); apply(await roomService.getGameState(code)); setConfirmReset(''); return '你的出題歷史已重置。' }) }}>確認重置我的歷史</button><button className="text-button" disabled={busy} onClick={() => setConfirmReset('')}>取消重置</button></>}</div>}
    <Feedback error={action.error} message={action.message} />
    <p className="form-note">目前不會自動同步，請按「重新取得遊戲狀態」。重新整理網頁不會重新抽題。</p>
  </section>
}
