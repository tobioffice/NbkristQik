/**
 * The 75% minimum drawn across the register between the last confirmed row
 * and the first row below it — the one line every student knows.
 */
export default function TheLine() {
  return (
    <div className="the-line" role="note">
      <b>75% — minimum requirement</b>
      <span>below this line</span>
    </div>
  );
}
