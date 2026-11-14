/**
 * The 75% minimum, drawn between the last confirmed row and the first row
 * below it. It stays a list item so the ranked list keeps its semantics.
 */
export default function TheLine() {
  return (
    <li className="tg-line">
      <b>75% minimum</b>
      <span>Below this line</span>
    </li>
  );
}
