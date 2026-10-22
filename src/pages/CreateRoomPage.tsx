import { useState } from "react";
import { Link } from "react-router-dom";
import { categories } from "../data/categories";
import { useAction } from "../hooks/useAction";
import { roomService } from "../services/rooms";
import { Feedback } from "../components/Feedback";
import { QUESTIONS_PER_GAME } from "../types/game";

export function CreateRoomPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction();
  function toggle(categoryId: string) {
    setSelected((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  }
  return (
    <section className="inner-page">
      <Link className="back-link" to="/">
        ← 回到首頁
      </Link>
      <p className="eyebrow">( be the host )</p>
      <h1>今天，想猜哪一種？</h1>
      <p className="page-description">
        你來當主持人！選擇喜歡的人物分類，讓每一題都有驚喜。
      </p>
      <p className="mock-label">分類為 Mock Data · 尚未連接真實題庫</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(() => roomService.createPreview(selected));
        }}
      >
        <fieldset>
          <legend className="selection-heading">
            選擇人物分類 <span>可複選</span>
          </legend>
          <div className="category-grid">
            {categories.map((category) => (
              <label
                key={category.id}
                className={`category-card ${category.color} ${selected.includes(category.id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(category.id)}
                  onChange={() => toggle(category.id)}
                />
                <span className="category-symbol" aria-hidden="true">
                  {category.symbol}
                </span>
                <span className="category-english">{category.englishName}</span>
                <strong>{category.name}</strong>
                <span className="category-description">
                  {category.description}
                </span>
              </label>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="feedback">目前沒有可選分類，請稍後再試。</p>
          )}
        </fieldset>
        <div className="selection-summary">
          <p>
            <strong>已選 {selected.length} 個分類</strong>
            <span>
              每場固定 {QUESTIONS_PER_GAME} 題 ·
              正式版將由伺服器隨機出題，不重複人物
            </span>
          </p>
          <button
            className="button button-primary"
            disabled={action.loading || !selected.length}
          >
            {action.loading ? "處理中…" : "預覽建立房間"}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <Feedback error={action.error} message={action.message} />
      </form>
      <p className="form-note">此階段不會建立真實房間或產生主持人憑證。</p>
    </section>
  );
}
