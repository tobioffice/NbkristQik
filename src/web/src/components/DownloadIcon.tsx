/**
 * The accent download control's icon: an arrow into a tray, drawn as one
 * 1.8px single-stroke path set. The button that holds it owns the accessible
 * name, so the glyph is hidden from assistive tech.
 */
export default function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v10" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </svg>
  );
}
