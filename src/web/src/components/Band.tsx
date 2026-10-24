interface BandStamp {
  value: string;
  label: string;
}

interface BandProps {
  sub: string;
  stamp?: BandStamp | null;
  /**
   * Where the wordmark goes. When the app has sections, the wordmark is the
   * way back to the index page, so it becomes a button with a visible focus
   * ring and an accessible name.
   */
  onHome?: () => void;
}

/**
 * Cloth head band shared by every surface: wordmark, context line, and an
 * optional stamp block for a headline figure.
 *
 * The band is the register's binding — one per surface, at the head. It is
 * not a utility bar: nothing else lives here.
 */
export default function Band({ sub, stamp, onHome }: BandProps) {
  const head = (
    <>
      <h1 className="reg-band__title">NbkristQik</h1>
      <p className="reg-band__sub">{sub}</p>
    </>
  );

  return (
    <header className="reg-band">
      {onHome ? (
        <button
          className="reg-band__home"
          onClick={onHome}
          aria-label="Back to the index"
        >
          {head}
        </button>
      ) : (
        <div>{head}</div>
      )}
      {stamp ? (
        <div className="reg-band__stamp">
          <b>{stamp.value}</b>
          <span>{stamp.label}</span>
        </div>
      ) : null}
    </header>
  );
}
