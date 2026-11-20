import ImagePicker from "./ImagePicker";

/** Kept in step with `src/services/reportFiles.ts`. */
export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

interface ReportScreenshotsProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * The screenshot picker on a report or a thread reply.
 *
 * Up to three images, five megabytes each. The shared picker owns the local
 * preview and the friendly rejection; the server still checks every byte.
 */
export default function ReportScreenshots({
  files,
  onChange,
  disabled = false,
}: ReportScreenshotsProps) {
  return (
    <ImagePicker
      files={files}
      onChange={onChange}
      disabled={disabled}
      maxFiles={MAX_SCREENSHOTS}
      maxBytes={MAX_SCREENSHOT_BYTES}
      addLabel="Add screenshots"
      noun="screenshot"
      hint={`Up to ${MAX_SCREENSHOTS} · 5 MB each`}
    />
  );
}
