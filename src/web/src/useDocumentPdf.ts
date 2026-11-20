import { useCallback, useState } from "react";
import { notifyReader, openDocumentPdf } from "./documentPdf";

/**
 * One document at a time, with the row that asked for it.
 *
 * The server mints a viewer link, so a second tap while that is in flight
 * would only ask for another. The id is state so the button that was tapped
 * can show that it is working.
 */
export const useDocumentPdf = (): {
  busyId: string | null;
  open: (docId: string) => void;
} => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = useCallback(
    (docId: string) => {
      if (busyId) return;
      setBusyId(docId);
      void openDocumentPdf(docId)
        .catch((e: unknown) => {
          notifyReader(
            e instanceof Error ? e.message : "Could not open this PDF.",
          );
        })
        .finally(() => setBusyId(null));
    },
    [busyId],
  );

  return { busyId, open };
};
