import type { ReactNode } from "react";
import { BandStampContext, type BandStamp } from "./bandStamp";

/** Shell side: lets the current page publish a stamp into the band. */
export default function BandStampProvider({
  onChange,
  children,
}: {
  onChange: (stamp: BandStamp | null) => void;
  children: ReactNode;
}) {
  return (
    <BandStampContext.Provider value={onChange}>
      {children}
    </BandStampContext.Provider>
  );
}
