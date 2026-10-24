import { memo } from "react";
import { PAGE_RATIO } from "../pagePosition";

/**
 * One page box.
 *
 * A box is drawn empty and filled later: it holds the page's shape while the
 * SVG is on its way, so the scrollbar is honest from the first frame and the
 * reader can jump to any page before the middle of the document exists.
 *
 * The image is not draggable, not selectable and has no context menu, so a
 * page cannot be saved out of the reader by a long press.
 */
interface ReaderPageProps {
  page: number;
  failed: boolean;
  /** True once the page image has drawn: the skeleton steps aside. */
  loaded: boolean;
  onRetry: (page: number) => void;
  onBox: (page: number, element: HTMLDivElement | null) => void;
  onImage: (page: number, element: HTMLImageElement | null) => void;
}

const ReaderPage = ({
  page,
  failed,
  loaded,
  onRetry,
  onBox,
  onImage,
}: ReaderPageProps) => (
  <div
    className={`reader__page${failed ? " reader__page--failed" : ""}${
      loaded ? " reader__page--loaded" : ""
    }`}
    data-page={page}
    ref={(element) => onBox(page, element)}
    style={{ aspectRatio: `1 / ${PAGE_RATIO}` }}
    onClick={failed ? () => onRetry(page) : undefined}
  >
    <div className="reader__skeleton">
      <b>{page}</b>
      <span>{failed ? "Did not load · tap to try again" : "Loading"}</span>
    </div>
    <img
      className="reader__canvas"
      ref={(element) => onImage(page, element)}
      alt=""
      onContextMenu={(e) => e.preventDefault()}
      draggable={false}
    />
  </div>
);

export default memo(ReaderPage);
