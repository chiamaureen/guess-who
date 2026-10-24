import { useEffect, useState } from "react";
import { roomService } from "../services/rooms";
import { useAction } from "../hooks/useAction";
import type { GameAction, GameState } from "../types/game-engine";
import type { LobbyState } from "../types/game";
import { Feedback } from "./Feedback";
import { RoomApiError } from "../lib/room-api";
import { ImageCredits } from "./ImageCredits";

export function GamePanel({
  code,
  roomStatus,
  state,
  onRefresh,
  onControl,
  onReset,
}: {
  code: string;
  roomStatus: LobbyState["room"]["status"];
  state: GameState | null;
  onRefresh: () => void;
  onControl: (operation: GameAction, questionId?: string) => Promise<void>;
  onReset: (revision: string) => Promise<void>;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageQuestionId, setImageQuestionId] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageRevision, setImageRevision] = useState(0);
  const [confirmFinish, setConfirmFinish] = useState("");
  const [confirmReset, setConfirmReset] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const action = useAction();
  const questionId = state?.question?.id;
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    setImageUrl("");
    setImageError("");
    const load = async () => {
      if (!questionId || !active) return;
      try {
        const image = await roomService.getGameImage(code, questionId);
        if (!active) return;
        objectUrl = URL.createObjectURL(image);
        setImageUrl(objectUrl);
        setImageQuestionId(questionId);
        setImageError("");
      } catch (cause) {
        if (!active) return;
        setImageError(
          cause instanceof Error ? cause.message : "圖片載入失敗。",
        );
        if (
          !(cause instanceof RoomApiError) ||
          ![401, 403, 410].includes(cause.status)
        )
          retry = setTimeout(
            () => {
              void load();
            },
            cause instanceof RoomApiError && cause.status === 429
              ? cause.retryAfter * 1000 + 250
              : Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4)),
          );
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(retry);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code, questionId, imageRevision]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(false), 5000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  const control = (operation: GameAction, expectedQuestionId?: string) => {
    void action.run(async () => {
      await onControl(
        operation,
        operation === "start-game"
          ? undefined
          : (expectedQuestionId ?? state?.question?.id),
      );
      setConfirmFinish("");
      setConfirmReset("");
      return "";
    });
  };
  const busy = action.loading || !state;
  const host = state?.viewer.role === "host";
  const playing = roomStatus === "playing";
  const question = state?.question;
  return (
    <section className="game-panel lobby-panel" aria-label="遊戲區域">
      <div className="player-list-heading">
        <h2>
          猜猜我是誰{" "}
          <span>{state ? `${state.room.currentQuestion}/15` : ""}</span>
        </h2>
        <button
          className="text-button"
          disabled={busy || cooldown}
          onClick={() => {
            setCooldown(true);
            onRefresh();
          }}
        >
          {cooldown ? "請稍候 5 秒" : "重新取得遊戲狀態"}
        </button>
      </div>
      {!state && <p role="status">正在恢復遊戲狀態…</p>}
      {state && roomStatus === "waiting" && (
        <>
          {host ? (
            <>
              <p className="py-4">準備好後開始。</p>
              <button
                className="button button-primary button-static pl-9"
                disabled={busy}
                onClick={() => control("start-game")}
              >
                開始遊戲
              </button>
            </>
          ) : (
            <p>等待主持人開始遊戲，畫面將自動同步。</p>
          )}
        </>
      )}
      {question && (
        <>
          <p className="eyebrow">
            QUESTION {question.number} / 15 ·{" "}
            {question.revealed ? "已揭曉" : "尚未揭曉"}
          </p>
          <div className="game-photo">
            {imageUrl && imageQuestionId === questionId ? (
              <img src={imageUrl} alt={`第 ${question.number} 題人物照片`} />
            ) : (
              <p role="status">{imageError || "正在載入照片…"}</p>
            )}
          </div>
          {imageError && (
            <button
              className="text-button"
              disabled={action.loading}
              onClick={() => setImageRevision((value) => value + 1)}
            >
              重新載入圖片
            </button>
          )}
          {question.answer ? (
            <div className="game-answer">
              <p>
                {host && !question.revealed
                  ? "主持人專屬答案・尚未向玩家揭曉"
                  : "正確答案"}
              </p>
              <h3>{question.answer}</h3>
              {question.attribution && <ImageCredits credit={question.attribution} />}
            </div>
          ) : (
            <p className="game-answer" role="status">
              {playing
                ? "先口頭猜猜看，等待主持人揭曉答案。"
                : "本題未揭曉，遊戲已結束。"}
            </p>
          )}
          {host && playing && (
            <div className="lobby-actions">
              <button
                className="button button-primary button-static"
                disabled={busy || question.revealed}
                onClick={() => control("reveal-answer")}
              >
                揭曉答案
              </button>
              <button
                className="button button-outline button-static"
                disabled={busy || !question.revealed || question.number === 15}
                onClick={() => control("next-question")}
              >
                下一題
              </button>
              {!confirmFinish ? (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => setConfirmFinish(question.id)}
                >
                  {question.number === 15 && question.revealed
                    ? "結束遊戲"
                    : "提前結束遊戲"}
                </button>
              ) : (
                <>
                  <p>確定結束？已使用的人物仍會保留在歷史。</p>
                  <button
                    className="button button-outline button-static"
                    disabled={busy}
                    onClick={() => control("finish-game", confirmFinish)}
                  >
                    確認結束遊戲
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setConfirmFinish("")}
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {state && roomStatus === "finished" && (
        <p role="status">遊戲已結束，已出現人物保留在主持人的跨場歷史中。</p>
      )}
      {host && !playing && state?.historyRevision && (
        <div className="game-reset">
          {!confirmReset ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setConfirmReset(state.historyRevision!)}
            >
              重置我的出題歷史
            </button>
          ) : (
            <>
              <p>
                只清除你的跨場去重紀錄，保留已完成題目。確定要讓舊人物再次出現嗎？
              </p>
              <button
                className="button button-outline button-static"
                disabled={busy}
                onClick={() => {
                  void action.run(async () => {
                    await onReset(confirmReset);
                    setConfirmReset("");
                    return "你的出題歷史已重置。";
                  });
                }}
              >
                確認重置我的歷史
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setConfirmReset("")}
              >
                取消重置
              </button>
            </>
          )}
        </div>
      )}
      <Feedback error={action.error} message={action.message} />
      <p className="form-note">
        狀態變更將自動同步；斷線後會自動恢復。重新整理不會重新抽題。
      </p>
    </section>
  );
}
