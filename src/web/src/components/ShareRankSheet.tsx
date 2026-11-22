import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RankInfo, RankScope, SortBy } from "../api";
import { requestRankShare, sendRankCard, uploadRankCard } from "../api";
import { buildRankCardModel, renderRankCard } from "../shareCard";
import { haptic, telegramWebApp } from "../telegram";
import { useBackHandler } from "../backButton";

/** The one link every share carries back to the register. */
const RANK_LINK = "https://t.me/NbkristQik_bot?startapp=rank";

interface ShareRankSheetProps {
  initData?: string;
  userId?: string;
  sortBy: SortBy;
  scope: RankScope;
  scopeLabel: string;
  rank: RankInfo;
  /** `Synced 2 hours ago`, when the register gave one. */
  syncNote: string | null;
  onClose: () => void;
}

const scoreText = (sortBy: SortBy, value: number | null): string | null => {
  if (value == null) return null;
  return sortBy === "attendance" ? `${value.toFixed(2)}%` : value.toFixed(1);
};

const shareMessage = ({
  sortBy,
  rank,
  scope,
  scopeLabel,
}: {
  sortBy: SortBy;
  rank: RankInfo;
  scope: RankScope;
  scopeLabel: string;
}): string => {
  const score = scoreText(sortBy, rank.value);
  const where = scope === "section" ? `in ${scopeLabel}` : "students";
  const tail = score
    ? sortBy === "attendance"
      ? ` at ${score} attendance`
      : ` with a ${score} mid-mark average`
    : "";
  return (
    `I'm #${rank.rank} of ${rank.total.toLocaleString()} ${where}` +
    `${tail}. Where do you stand? ${RANK_LINK}`
  );
};

const copyFallback = (text: string): boolean => {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
};

const PlaneIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const StoryIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

const SaveIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 21h14" />
  </svg>
);

const ChatIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5Z" />
  </svg>
);

const LinkIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  </svg>
);

const ShareIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
  </svg>
);

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

const ShareRow = ({
  icon,
  label,
  hint,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="tg-share-row"
    onClick={onClick}
    disabled={disabled || busy}
  >
    <span className="tg-share-row__icon">{icon}</span>
    <span className="tg-row__body">
      <span className="tg-row__title">{busy ? `${label}…` : label}</span>
      <span className="tg-row__sub">{hint}</span>
    </span>
  </button>
);

/**
 * The share surface: one drawn card, and only the destinations that work.
 *
 * The card is drawn and uploaded as the sheet opens, not after the tap:
 * Telegram's story editor and the file share want to be called inside the
 * gesture, and the preview needs the same bytes anyway.
 */
export default function ShareRankSheet({
  initData,
  userId,
  sortBy,
  scope,
  scopeLabel,
  rank,
  syncNote,
  onClose,
}: ShareRankSheetProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [card, setCard] = useState<{ id: string; url: string } | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const data = useMemo(
    () => ({
      sort: sortBy,
      rank: rank.rank,
      total: rank.total,
      value: rank.value,
      scope,
      scopeLabel,
    }),
    [sortBy, scope, scopeLabel, rank.rank, rank.total, rank.value],
  );

  const model = useMemo(() => buildRankCardModel(data), [data]);
  const canShareFiles = useMemo(() => {
    if (!blob || typeof navigator === "undefined") return false;
    const file = new File([blob], "nbkristqik-rank.jpg", {
      type: "image/jpeg",
    });
    try {
      return Boolean(navigator.canShare?.({ files: [file] }));
    } catch {
      return false;
    }
  }, [blob]);
  const plain = useMemo(
    () => shareMessage({ sortBy, rank, scope, scopeLabel }),
    [sortBy, rank, scope, scopeLabel],
  );
  const storyText = useMemo(() => {
    const score = scoreText(sortBy, rank.value);
    const where = scope === "section" ? `in ${scopeLabel}` : "students";
    return (
      `#${rank.rank} of ${rank.total.toLocaleString()} ${where}` +
      (score ? ` · ${score}` : "")
    ).slice(0, 200);
  }, [sortBy, rank, scope, scopeLabel]);

  const app = telegramWebApp();
  const canStory = typeof app?.shareToStory === "function";
  const canDownload = typeof app?.downloadFile === "function";

  // Native dialog: top layer, focus containment, Esc/back dismissal.
  useBackHandler(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const closed = () => onClose();
    dialog.addEventListener("close", closed);
    return () => {
      dialog.removeEventListener("close", closed);
    };
  }, [onClose]);

  // Draw + upload once per board/sort. The preview is local; the upload only
  // exists because Telegram fetches story/photo media from its own servers.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const run = async () => {
      let drawn: Blob | null = null;
      try {
        drawn = await renderRankCard(data);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(drawn);
        setBlob(drawn);
        setPreview(objectUrl);
      } catch (error) {
        if (!cancelled) {
          setDrawError(
            error instanceof Error
              ? error.message
              : "The card could not be drawn.",
          );
        }
        return;
      }
      if (!drawn) return;

      try {
        const uploaded = await uploadRankCard({
          initData,
          userId,
          blob: drawn,
        });
        if (!cancelled) setCard(uploaded);
      } catch {
        if (!cancelled) {
          setStatus("The image is ready, but Telegram can’t fetch it yet.");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, initData, userId]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      setStatus(null);
      try {
        await action();
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "That didn’t work. Try again.",
        );
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const sendInTelegram = useCallback(() => {
    if (!app?.shareMessage) {
      setStatus("Sharing in Telegram needs a newer app.");
      return;
    }
    haptic.tap();
    void runAction("telegram", async () => {
      const prepared = await requestRankShare({
        initData,
        userId,
        sort: sortBy,
        scope,
        cardId: card?.id,
      });
      app.shareMessage?.(prepared.id, (sent) => {
        if (sent) {
          haptic.tap();
          setStatus("Shared.");
        }
      });
    });
  }, [app, card?.id, initData, runAction, scope, sortBy, userId]);

  const addToStory = useCallback(() => {
    if (!app?.shareToStory) {
      setStatus("Stories need a newer Telegram app.");
      return;
    }
    if (!card) {
      setStatus("The card is still preparing.");
      return;
    }
    if (window.location.protocol !== "https:") {
      setStatus("Stories need the published app.");
      return;
    }
    haptic.tap();
    try {
      app.shareToStory(card.url, {
        text: storyText,
        widget_link: { url: RANK_LINK, name: "NbkristQik" },
      });
    } catch {
      setStatus("Stories aren’t available on this client.");
    }
  }, [app, card, storyText]);

  const saveToPhotos = useCallback(() => {
    if (!card) {
      setStatus("The card is still preparing.");
      return;
    }
    haptic.tap();
    void runAction("save", async () => {
      await sendRankCard({ initData, userId, cardId: card.id });
      setStatus("Sent to your chat. Long-press the card to save it.");
      haptic.tap();
      telegramWebApp()?.showAlert?.(
        "Sent to your chat. Long-press the card to save it, then add it to your Instagram story or WhatsApp status.",
      );
    });
  }, [card, initData, runAction, userId]);

  const openWhatsApp = useCallback(() => {
    haptic.tap();
    const url = `https://wa.me/?text=${encodeURIComponent(plain)}`;
    try {
      const open = telegramWebApp()?.openLink;
      if (open) open(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [plain]);

  const copy = useCallback(() => {
    haptic.tap();
    void runAction("copy", async () => {
      let copiedNow = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(plain);
          copiedNow = true;
        }
      } catch {
        copiedNow = false;
      }
      if (!copiedNow) copiedNow = copyFallback(plain);
      if (!copiedNow) throw new Error("Could not copy the message.");
      setCopied(true);
      setStatus("Copied.");
      haptic.tap();
    });
  }, [plain, runAction]);

  const shareImage = useCallback(() => {
    if (!blob || !canShareFiles || !navigator.share) return;
    haptic.tap();
    void runAction("share", async () => {
      const file = new File([blob], "nbkristqik-rank.jpg", {
        type: "image/jpeg",
      });
      try {
        await navigator.share?.({ files: [file], text: plain });
      } catch (error) {
        // The student closing the OS sheet is not a failure.
        if ((error as Error)?.name === "AbortError") return;
        throw error;
      }
    });
  }, [blob, canShareFiles, plain, runAction]);

  const download = useCallback(() => {
    haptic.tap();
    if (card && canDownload) {
      try {
        app?.downloadFile?.({
          url: `${card.url}?download=1`,
          file_name: "nbkristqik-rank.jpg",
        });
        return;
      } catch {
        // fall through to the anchor download
      }
    }
    if (!preview) {
      setStatus("The card is still preparing.");
      return;
    }
    const link = document.createElement("a");
    link.href = preview;
    link.download = "nbkristqik-rank.jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [app, canDownload, card, preview]);

  return (
    <dialog
      ref={dialogRef}
      className="tg-sheet tg-share-sheet"
      aria-labelledby="tg-share-title"
      aria-describedby="tg-share-desc"
      closedby="any"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="tg-sheet-grabber" aria-hidden="true" />
      <div className="tg-sheet-head">
        <div>
          <h2 className="tg-sheet-title" id="tg-share-title">
            Share your rank
          </h2>
          <p className="tg-sheet-desc" id="tg-share-desc">
            No classmate is named.
          </p>
        </div>
        <button
          type="button"
          className="tg-sheet-close"
          onClick={onClose}
          aria-label="Close share"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="tg-sheet-body">
        <div className="tg-share-preview">
          {preview ? (
            <img className="tg-share-card" src={preview} alt={model.alt} />
          ) : (
            <div className="tg-share-card tg-share-card--empty">
              {drawError ?? "Preparing card…"}
            </div>
          )}
        </div>

        <div className="tg-group tg-share-actions">
          <ShareRow
            icon={<PlaneIcon />}
            label="Send in Telegram"
            hint="Opens the share sheet in Telegram."
            busy={busy === "telegram"}
            onClick={sendInTelegram}
          />
          {canStory ? (
            <ShareRow
              icon={<StoryIcon />}
              label="Add to story"
              hint={
                card ? "Opens Telegram’s story editor." : "Preparing the card…"
              }
              disabled={!card}
              onClick={addToStory}
            />
          ) : null}
          <ShareRow
            icon={<SaveIcon />}
            label="Save to photos"
            hint={
              card
                ? "For Instagram stories or WhatsApp status. We send it to your chat."
                : "Preparing the card…"
            }
            busy={busy === "save"}
            disabled={!card}
            onClick={saveToPhotos}
          />
          <ShareRow
            icon={<ChatIcon />}
            label="WhatsApp"
            hint="Opens WhatsApp with your message and link."
            onClick={openWhatsApp}
          />
          <ShareRow
            icon={<LinkIcon />}
            label={copied ? "Copied" : "Copy message"}
            hint="Text and link, for any app."
            busy={busy === "copy"}
            onClick={copy}
          />
          {canShareFiles ? (
            <ShareRow
              icon={<ShareIcon />}
              label="Share image"
              hint="Instagram, WhatsApp and any other app."
              busy={busy === "share"}
              onClick={shareImage}
            />
          ) : (
            <ShareRow
              icon={<ShareIcon />}
              label="Save image"
              hint="Downloads the card to this device."
              disabled={!preview}
              onClick={download}
            />
          )}
        </div>

        {status ? (
          <p className="tg-share-status" role="status">
            {status}
          </p>
        ) : null}

        <p className="tg-share-note">
          {syncNote
            ? `Rank from the register. ${syncNote}.`
            : "Rank from the register."}
        </p>
      </div>
    </dialog>
  );
}
