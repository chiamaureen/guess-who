import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Feedback } from "../components/Feedback";
import { useAction } from "../hooks/useAction";
import { roomService } from "../services/rooms";

export function JoinRoomPage({ invitationCode }: { invitationCode?: string }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState(
    (invitationCode ?? params.get("code") ?? "").toUpperCase().slice(0, 6),
  );
  const [nickname, setNickname] = useState("");
  const action = useAction();
  return (
    <section className="inner-page join-page">
      <Link className="back-link" to="/">
        ← 回到首頁
      </Link>
      <div className="join-layout">
        <div>
          <p className="eyebrow">( come join the fun )</p>
          <h1>
            朋友都在，
            <br />
            <span className="accent">就等你啦！</span>
          </h1>
          <p className="page-description">
            輸入主持人分享的房間代碼，
            <br />
            再取個好記的名字，準備一起猜猜看。
          </p>
          <div className="join-doodle" aria-hidden="true">
            You<span>＋</span>Us<small>GOOD TIMES TOGETHER.</small>
          </div>
        </div>
        <form
          className="join-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              const state = await roomService.join({ roomCode, nickname });
              void navigate(`/room/${state.room.code}`, { replace: true });
              return "";
            });
          }}
        >
          <span className="form-kicker">( your seat is waiting )</span>
          <h2>加入房間</h2>
          <label htmlFor="room-code">房間代碼</label>
          <input
            id="room-code"
            className="code-input"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-describedby="code-help"
          />
          <p id="code-help" className="input-help">
            向主持人索取 6 碼英文字母或數字代碼。
          </p>
          <label htmlFor="nickname">你的暱稱</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="大家都怎麼叫你？"
            autoComplete="nickname"
            required
            aria-describedby="nickname-help"
          />
          <p id="nickname-help" className="input-help">
            1–20 個字，讓朋友一眼認出你。
          </p>
          <button
            type="submit"
            className="button button-primary button-static"
            disabled={action.loading}
          >
            {action.loading ? "加入中…" : "加入房間"}
            <span aria-hidden="true">→</span>
          </button>
          <Feedback error={action.error} message={action.message} />
          <p className="form-note">Session 保存在此瀏覽器，重新整理可恢復。等待室與遊戲狀態會定期自動同步。</p>
        </form>
      </div>
    </section>
  );
}
