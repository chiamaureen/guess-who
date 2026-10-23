import { Link } from 'react-router-dom'
import { Portraits } from '../components/Portraits'
import { DirectionalMarquee } from '../components/DirectionalMarquee'
import { MagneticButton } from '../components/MagneticButton'

export function HomePage() {
  return <>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">( a game for real connections )</p><h1><span className="hero-english" lang="en">Familiar faces.<br />Real fun<span className="title-question">.</span></span><span className="hero-chinese">看一張熟悉的臉，<br />一起找回相聚的樂趣。</span></h1><p className="hero-description">揪上朋友，看照片猜名人。<br />那些「名字就在嘴邊」的瞬間，才是最好玩的部分。</p>
      <div className="hero-actions"><MagneticButton to="/host" icon="↗">建立房間</MagneticButton><MagneticButton to="/join" variant="outline" icon="→">加入房間</MagneticButton></div><p className="hero-note">不用註冊 <span>·</span> 每場 15 題 <span>·</span> 有朋友就能玩</p></div>
      <Portraits />
    </section>
    <DirectionalMarquee />
    <section id="how-to-play" className="how-section"><div className="section-intro"><div><p className="eyebrow">( how to play )</p><h2>Good times.<br />Just three steps.</h2></div><p>快樂很簡單，三步就開玩。<br />帶上你的好記性，和一點點默契。</p></div>
    <div className="steps">{[
      ['01', '開一間房，揪一群人', '一人擔任主持人，選好喜歡的分類，其他朋友用房間代碼加入。', '⌂'],
      ['02', '看一張臉，猜一個名字', '每場 15 題，大家看照片、直接說出答案，讓主持人來判斷！', '☺'],
      ['03', '揭曉答案，收集笑聲', '主持人揭曉正解，再前往下一題。不比積分，只比誰笑得開心。', '✷'],
    ].map(([number, title, text, icon]) => <article className="step" key={number}><div className="step-top"><span>STEP {number}</span><span className="step-icon" aria-hidden="true">{icon}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <div className="preview-banner"><span>✳</span><p><strong>先集合，派對即將開始。</strong>已可建立與加入雲端房間，等待朋友入座；正式遊戲尚未開放。</p><Link to="/host">探索分類 →</Link></div>
  </>
}
