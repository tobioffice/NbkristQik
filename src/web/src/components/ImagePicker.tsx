import { useEffect, useRef, useState } from "react";

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

interface ImagePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles: number;
  maxBytes: number;
  /** The button label when the list is empty, e.g. "Add screenshots". */
  addLabel: string;
  /** Singular noun used in errors and alt text, e.g. "screenshot". */
  noun: string;
  /** The quiet line beside the button, e.g. "Up to 3 · 5 MB each". */
  hint: string;
}

/**
 * A picker for up to `maxFiles` PNG/JPEG/WebP images, with local previews.
 *
 * The browser can preview the chosen files immediately; the server still
 * checks every byte by its magic number and strips metadata, so this filter
 * is convenience, not trust.
 */
export default function ImagePicker({
  files,
  onChange,
  disabled = false,
  maxFiles,
  maxBytes,
  addLabel,
  noun,
  hint,
}: ImagePickerProps) {
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

    if (files.length + picked.length > maxFiles) {
      setError(`Up to ${maxFiles} ${noun}s.`);
      return;
    }
    for (const file of picked) {
      if (!acceptable(file)) {
        const label = noun.charAt(0).toUpperCase() + noun.slice(1);
        setError(`${label}s need to be PNG, JPEG or WebP.`);
        return;
      }
      if (file.size === 0) {
        setError(`That ${noun} was empty. Try another.`);
        return;
      }
      if (file.size > maxBytes) {
        setError(`Each ${noun} must be under 5 MB.`);
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
          disabled={disabled || files.length >= maxFiles}
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
          {files.length > 0 ? "Add another" : addLabel}
        </button>
        <span className="shots-hint">{hint}</span>
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
                alt={`${noun} ${index + 1} of ${previews.length}`}
                decoding="async"
              />
              <button
                type="button"
                className="shot__remove"
                aria-label={`Remove ${noun} ${index + 1}`}
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
