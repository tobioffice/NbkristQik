import { useCallback, useState } from "react";
import { explainDownloadFailure, saveDocumentPdf } from "./documentDownload";

/**
 * One PDF download at a time, with the row that asked for it.
 *
 * Preparing a document is a request plus, on the server, a stamped PDF; a
 * second tap while that is in flight would only queue another. The id is
 * state so the button that was tapped can show that it is working.
 */
export const useDocumentPdf = (): {
  busyId: string | null;
  save: (docId: string) => void;
} => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const save = useCallback(
    (docId: string) => {
      if (busyId) return;
      setBusyId(docId);
      void saveDocumentPdf(docId)
        .catch((e: unknown) => {
          explainDownloadFailure(
            e instanceof Error ? e.message : "Could not prepare this PDF.",
          );
        })
        .finally(() => setBusyId(null));
    },
    [busyId],
  );

  return { busyId, save };
};
