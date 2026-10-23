import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCategories } from "../hooks/useCategories";
import { useAction } from "../hooks/useAction";
import { roomService } from "../services/rooms";
import { Feedback } from "../components/Feedback";
import { QUESTIONS_PER_GAME } from "../types/game";
import { MagneticButton } from "../components/MagneticButton";

export function CreateRoomPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [savedCodes, setSavedCodes] = useState<string[]>([]);
  const [storageError, setStorageError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { categories, loading, error, retry } = useCategories();
  const navigate = useNavigate();
  const action = useAction();
  useEffect(() => {
    try {
      const request = roomService.pendingCreation();
      if (request) { setPending(true); setSelected(request.categoryIds); }
      setSavedCodes(roomService.savedCodes());
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : "無法讀取本機身分。"); }
  }, []);
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
      <p className="mock-label">分類來自 Supabase · 本階段開放等待室，遊戲尚未開放</p>
      {savedCodes.length > 0 && <div className="saved-rooms"><p>繼續已保存的房間：</p>{savedCodes.map(code => <Link key={code} to={`/room/${code}`}>{code} ↗</Link>)}</div>}
      {pending && <p className="feedback" role="status">上次建立結果尚待確認，重試會沿用原分類與請求，不會另開房間。</p>}
      {loading && <p className="feedback" role="status">正在讀取分類…</p>}
      <Feedback error={error || storageError} message="" />
      {error && <button type="button" className="button button-outline button-static" onClick={retry}>重試讀取分類</button>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            try {
              const state = await roomService.create(selected);
              void navigate(`/room/${state.room.code}`);
              return "";
            } finally { setPending(!!roomService.pendingCreation()); }
          });
        }}
      >
        <fieldset disabled={action.loading || pending || loading}>
          <legend className="selection-heading">
            選擇人物分類 <span>可複選</span>
          </legend>
          <div className="category-grid">
            {categories.map((category, index) => (
              <label
                key={category.id}
                className={`category-card ${["peach", "yellow", "green", "blue", "purple", "pink"][index % 6]} ${selected.includes(category.id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(category.id)}
                  onChange={() => toggle(category.id)}
                />
                <span className="category-symbol" aria-hidden="true">
                  {["✳", "♫", "◎", "✷", "◇", "☺"][index % 6]}
                </span>
                <span className="category-english">{category.slug.replace(/-/g, " ").toUpperCase()}</span>
                <strong>{category.name}</strong>
                <span className="category-description">
                  一起挑戰這個分類的人物。
                </span>
              </label>
            ))}
          </div>
          {!loading && !error && categories.length === 0 && (
            <p className="feedback">目前沒有可選分類，請稍後再試。</p>
          )}
        </fieldset>
        <div className="selection-summary">
          <p>
            <strong>已選 {selected.length} 個分類</strong>
            <span>
              每場固定 {QUESTIONS_PER_GAME} 題 ·
              等待室不會開始出題，遊戲引擎將於下一階段開放
            </span>
          </p>
          <MagneticButton
            icon="↗"
            disabled={action.loading || loading || !!error || !!storageError || (!selected.length && !pending)}
          >
            {action.loading ? "建立中…" : pending ? "確認上次建立結果" : "建立房間"}
          </MagneticButton>
        </div>
        <Feedback error={action.error} message={action.message} />
      </form>
      <p className="form-note">身分只保存在此瀏覽器，請勿清除網站資料或在共用裝置操作。房間 24 小時後過期。</p>
      <details className="identity-settings"><summary>主持人身分與安全</summary><p>清除此身分後無法恢復舊房間控制權，舊歷史不會刪除。請先關閉所有房間；這不是重置題目歷史。</p>{!confirmRevoke ? <button type="button" className="text-button" onClick={() => setConfirmRevoke(true)}>撤銷此裝置主持人身分</button> : <div className="lobby-actions"><button type="button" className="button button-outline button-static" disabled={action.loading} onClick={() => { void action.run(async () => { await roomService.revokeHost(); setSavedCodes(roomService.savedCodes()); setPending(false); setConfirmRevoke(false); return "舊主持人憑證已撤銷，下次建立房間會建立新身分。"; }); }}>確認撤銷身分</button><button type="button" className="text-button" onClick={() => setConfirmRevoke(false)}>取消</button></div>}</details>
    </section>
  );
}
