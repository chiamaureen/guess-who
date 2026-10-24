import { Link } from "react-router-dom";
import { Portraits } from "../components/Portraits";
import { DirectionalMarquee } from "../components/DirectionalMarquee";
import { ArrowUpRight } from "../components/ArrowUpRight";

export function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">( a game for real connections )</p>
          <h1>
            <span className="hero-english" lang="en">
              Familiar faces.
              <br />
              Real fun<span className="title-question">.</span>
            </span>
            <span className="hero-chinese">
              揪上朋友
              <br />
              猜猜這是誰。
            </span>
          </h1>
          <p className="hero-description">
            不用註冊
            <br />
            馬上就能玩
          </p>
          <div className="hero-actions">
            <Link to="/host" className="button button-primary button-static">
              <span className="button-label">建立房間</span>
              <span aria-hidden="true"><ArrowUpRight /></span>
            </Link>
            <Link to="/join" className="button button-outline button-static">
              <span className="button-label">加入房間</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="hero-note">
            {/* 不用註冊 <span>·</span> 每場 15 題 <span>·</span> 有朋友就能玩 */}
          </p>
        </div>
        <Portraits />
      </section>
      <DirectionalMarquee />
      <section id="how-to-play" className="how-section">
        <div className="section-intro">
          <div>
            <p className="eyebrow">( how to play )</p>
            <h2>
              Good times.
              <br />
              Just three steps.
            </h2>
          </div>
          <p>
            快樂很簡單，三步就開玩。
            <br />
            帶上你的好記性，和一點點默契。
          </p>
        </div>
        <div className="steps">
          {[
            [
              "01",
              "開一間房，揪一群人",
              "一人擔任主持人，選好喜歡的分類，其他朋友用房間代碼加入。",
              "⌂",
            ],
            [
              "02",
              "看一張臉，猜一個名字",
              "每場 15 題，大家看照片、直接說出答案，讓主持人來判斷！",
              "☺",
            ],
            [
              "03",
              "揭曉答案，收集笑聲",
              "主持人揭曉正解，再前往下一題。不比積分，只比誰笑得開心。",
              "✷",
            ],
          ].map(([number, title, text, icon]) => (
            <article className="step" key={number}>
              <div className="step-top">
                <span>STEP {number}</span>
                <span className="step-icon" aria-hidden="true">
                  {icon}
                </span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="preview-banner">
        <span>✳</span>
        <p>
          <strong>先集合，派對即將開始。</strong>
          已可建立與加入雲端房間，等待朋友入座；正式遊戲尚未開放。
        </p>
        <Link to="/host">探索分類 →</Link>
      </div>
    </>
  );
}
