import { useCallback, useState } from "react";
import { notifyReader, sendDocumentPdf } from "./documentSend";

/**
 * One document at a time, with the row that asked for it.
 *
 * The server stamps a PDF and the bot uploads it, so a second tap while that
 * is in flight would only queue another send. The id is state so the button
 * that was tapped can show that it is working.
 */
export const useDocumentSend = (): {
  busyId: string | null;
  send: (docId: string) => void;
} => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const send = useCallback(
    (docId: string) => {
      if (busyId) return;
      setBusyId(docId);
      void sendDocumentPdf(docId)
        .catch((e: unknown) => {
          notifyReader(
            e instanceof Error ? e.message : "Could not send this PDF.",
          );
        })
        .finally(() => setBusyId(null));
    },
    [busyId],
  );

  return { busyId, send };
};
