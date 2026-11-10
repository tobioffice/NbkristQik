/**
 * The 75% minimum drawn across the register between the last confirmed row
 * and the first row below it — the one line every student knows.
 *
 * It lives inside the ranked list, so it is a list item like the rows: a
 * bare div there would break the list's semantics.
 */
export default function TheLine() {
  return (
    <li className="the-line">
      <b>75% — minimum requirement</b>
      <span>below this line</span>
    </li>
  );
}
