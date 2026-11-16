import { useEffect, useRef, useState } from "react";

/** Kept in step with `src/services/reportFiles.ts`. */
export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const ACCEPT_ATTR = "image/png,image/jpeg,image/webp";
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;

const acceptable = (file: File): boolean =>
  ACCEPTED.has(file.type) || (!file.type && IMAGE_EXTENSION.test(file.name));

interface ReportScreenshotsProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * The screenshot picker on a report or a thread reply.
 *
 * The browser can preview the chosen files immediately; the server still
 * checks every byte by its magic number, so this filter is convenience, not
 * trust. Up to three images, five megabytes each.
 */
export default function ReportScreenshots({
  files,
  onChange,
  disabled = false,
}: ReportScreenshotsProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  // Object URLs created during this screen's life. They are revoked together
  // on unmount: revoking on every change would break the StrictMode double
  // effect and flash a revoked image while the next preview is painted.
  const createdUrls = useRef<string[]>([]);

  useEffect(() => {
    const next = files.map((file) => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return url;
    });
    setPreviews(next);
  }, [files]);

  useEffect(
    () => () => {
      for (const url of createdUrls.current) URL.revokeObjectURL(url);
      createdUrls.current = [];
    },
    [],
  );

  const pick = (picked: File[]) => {
    if (picked.length === 0) return;
    setError(null);

    if (files.length + picked.length > MAX_SCREENSHOTS) {
      setError(`Up to ${MAX_SCREENSHOTS} screenshots per message.`);
      return;
    }
    for (const file of picked) {
      if (!acceptable(file)) {
        setError("Screenshots need to be PNG, JPEG or WebP.");
        return;
      }
      if (file.size === 0) {
        setError("That screenshot was empty. Try another.");
        return;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setError("Each screenshot must be under 5 MB.");
        return;
      }
    }

    onChange([...files, ...picked]);
  };

  const remove = (index: number) => {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="shots-field">
      <div className="shots-head">
        <input
          ref={input}
          className="shot-input"
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            // reset first, so picking the same file again still fires change
            e.target.value = "";
            pick(picked);
          }}
        />
        <button
          type="button"
          className="btn-outline btn-sm shot-add"
          disabled={disabled || files.length >= MAX_SCREENSHOTS}
          onClick={() => input.current?.click()}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          {files.length > 0 ? "Add another" : "Add screenshots"}
        </button>
        <span className="shots-hint">Up to 3 · 5 MB each</span>
      </div>

      {error && (
        <p className="note note--err mt-4" role="alert">
          {error}
        </p>
      )}

      {previews.length > 0 && (
        <ul className="shots">
          {previews.map((url, index) => (
            <li key={url} className="shot">
              <img
                src={url}
                alt={`Screenshot ${index + 1} of ${previews.length}`}
              />
              <button
                type="button"
                className="shot__remove"
                aria-label={`Remove screenshot ${index + 1}`}
                disabled={disabled}
                onClick={() => remove(index)}
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
