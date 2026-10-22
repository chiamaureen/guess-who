import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Feedback } from '../components/Feedback'
import { useAction } from '../hooks/useAction'
import { roomService } from '../services/rooms'

export function JoinRoomPage() {
  const [params] = useSearchParams()
  const [roomCode, setRoomCode] = useState((params.get('code') ?? '').toUpperCase().slice(0, 6))
  const [nickname, setNickname] = useState('')
  const action = useAction()
  return <section className="inner-page join-page"><Link className="back-link" to="/">← 回到首頁</Link><div className="join-layout"><div><p className="eyebrow">( come join the fun )</p><h1>朋友都在，<br />就等你<span className="accent">啦！</span></h1><p className="page-description">輸入主持人分享的房間代碼，<br />再取個好記的名字，準備一起猜猜看。</p><div className="join-doodle" aria-hidden="true">You<span>＋</span>Us<small>GOOD TIMES TOGETHER.</small></div></div><form className="join-form" onSubmit={event => { event.preventDefault(); void action.run(() => roomService.joinPreview({ roomCode, nickname })) }}><span className="form-kicker">( your seat is waiting )</span><h2>加入房間</h2><label htmlFor="room-code">房間代碼</label><input id="room-code" className="code-input" value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" autoComplete="off" autoCapitalize="characters" spellCheck={false} required aria-describedby="code-help" /><p id="code-help" className="input-help">向主持人索取 6 碼英文字母或數字代碼。</p><label htmlFor="nickname">你的暱稱</label><input id="nickname" value={nickname} onChange={event => setNickname(event.target.value)} placeholder="大家都怎麼叫你？" autoComplete="nickname" required aria-describedby="nickname-help" /><p id="nickname-help" className="input-help">1–20 個字，讓朋友一眼認出你。</p><button className="button button-primary" disabled={action.loading}>{action.loading ? '檢查中…' : '預覽加入房間'} <span aria-hidden="true">→</span></button><Feedback error={action.error} message={action.message} /><p className="form-note">目前為 UI 預覽，尚未連線至真實房間。</p></form></div></section>
}
