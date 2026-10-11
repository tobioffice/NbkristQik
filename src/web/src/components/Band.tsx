interface BandStamp {
  value: string;
  label: string;
}

interface BandProps {
  sub: string;
  stamp?: BandStamp | null;
}

/**
 * Cloth head band shared by all three mini apps: wordmark, context line,
 * and an optional stamp block for a headline count.
 */
export default function Band({ sub, stamp }: BandProps) {
  return (
    <header className="reg-band">
      <div>
        <h1 className="reg-band__title">NbkristQik</h1>
        <p className="reg-band__sub">{sub}</p>
      </div>
      {stamp ? (
        <div className="reg-band__stamp">
          <b>{stamp.value}</b>
          <span>{stamp.label}</span>
        </div>
      ) : null}
    </header>
  );
}
