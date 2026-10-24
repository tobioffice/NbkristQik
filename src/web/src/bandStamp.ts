import { createContext, useContext, useEffect } from "react";

/**
 * The cloth band's stamp, shared by the app shell and its pages.
 *
 * The design has one cloth band per surface, so a page cannot draw its own
 * head: the shell owns the band, and a page publishes the one figure that
 * belongs in its stamp (the shelf's ready units, the register's students, the
 * inbox's open issues). A page with nothing counted leaves the stamp empty.
 */

/** The figure printed in the band's stamp block. */
export interface BandStamp {
  value: string;
  label: string;
}

/** Setter the shell hands down; a page publishes through it. */
export const BandStampContext = createContext<
  (stamp: BandStamp | null) => void
>(() => {});

/**
 * Page side: publishes a stamp while the page asks for one.
 *
 * Pass a new object only when the figure changes; the effect keys off the
 * printed value and label, not the object identity.
 */
export const useBandStamp = (stamp: BandStamp | null): void => {
  const publish = useContext(BandStampContext);
  const value = stamp?.value;
  const label = stamp?.label;

  useEffect(() => {
    if (value === undefined || label === undefined) {
      publish(null);
      return;
    }
    publish({ value, label });
    return () => publish(null);
  }, [publish, value, label]);
};
