import { useRef, useState } from "react";
import type { ApiIdentity } from "../api";
import ImagePicker from "../components/ImagePicker";
import {
  MAX_PAPER_FILE_BYTES,
  MAX_PAPER_PAGES,
  uploadPaper,
} from "../papersApi";
import { haptic, useClosingConfirmation } from "../telegram";

/**
 * The hidden question-paper intake.
 *
 * This page is opened by a direct link, not by a tab. It collects the photos
 * of one paper and the subject/exam line the processing team needs. There is
 * no gallery here: the uploads are private, and the admin panel is the only
 * place they are read.
 */

interface PapersPageProps {
  identity: ApiIdentity;
}

type InvalidField = "subject" | "exam" | "note" | "photos" | null;

export default function PapersPage({ identity }: PapersPageProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState("");
  const [exam, setExam] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  const [received, setReceived] = useState<number | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const examRef = useRef<HTMLInputElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const photosRef = useRef<HTMLFieldSetElement | null>(null);

  const canUpload = Boolean(identity.userId || identity.initData);
  const hasDraft =
    !received &&
    (files.length > 0 ||
      subject.trim().length > 0 ||
      exam.trim().length > 0 ||
      note.trim().length > 0);

  useClosingConfirmation(hasDraft);

  const reset = () => {
    setFiles([]);
    setSubject("");
    setExam("");
    setNote("");
    setError(null);
    setInvalidField(null);
    setReceived(null);
    window.scrollTo(0, 0);
  };

  const fail = (message: string, field: InvalidField) => {
    setError(message);
    setInvalidField(field);
    if (field === "subject") subjectRef.current?.focus();
    else if (field === "exam") examRef.current?.focus();
    else if (field === "note") noteRef.current?.focus();
    else if (field === "photos") photosRef.current?.focus();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;

    setError(null);
    setInvalidField(null);

    const cleanSubject = subject.trim().replace(/\s+/g, " ");
    const cleanExam = exam.trim().replace(/\s+/g, " ");
    const cleanNote = note.trim().replace(/\s+/g, " ");

    if (cleanSubject.length < 2 || cleanSubject.length > 60) {
      fail("Add the subject, between 2 and 60 characters.", "subject");
      return;
    }
    if (cleanExam.length < 2 || cleanExam.length > 60) {
      fail("Add the exam, between 2 and 60 characters.", "exam");
      return;
    }
    if (cleanNote.length > 240) {
      fail("Keep the note under 240 characters.", "note");
      return;
    }
    if (files.length === 0) {
      fail("Add at least one photo of the paper.", "photos");
      return;
    }

    setSending(true);
    try {
      const receipt = await uploadPaper(
        identity,
        { subject: cleanSubject, exam: cleanExam, note: cleanNote },
        files,
      );
      setReceived(receipt.id);
      setFiles([]);
      setSubject("");
      setExam("");
      setNote("");
      window.scrollTo(0, 0);
      haptic.tap();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not add the paper. Try again.",
      );
    } finally {
      setSending(false);
    }
  };

  if (!canUpload) {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Question papers</p>
          <h2 className="page-title">Open this inside Telegram</h2>
          <p className="page-note">
            Adding a paper needs your Telegram account. Open this page from the
            link shared in the bot, inside Telegram. The collection is private;
            students cannot browse each other&rsquo;s uploads.
          </p>
        </div>
      </div>
    );
  }

  if (received !== null) {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Question papers</p>
          <h2 className="page-title">Paper received</h2>
          <p className="page-note">
            It is in the processing list. Thank you for adding it.
          </p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <div className="note note--ok" role="status">
              The photos and the subject/exam line arrived safely.
            </div>
            <div className="btn-row mt-5">
              <button type="button" className="btn-ink" onClick={reset}>
                Add another paper
              </button>
            </div>
            <p className="form-note mt-4">
              Tap the NbkristQik wordmark above to go back, or use a tab below.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Question papers</p>
        <h2 className="page-title" id="paper-upload-title">
          Add a paper
        </h2>
        <p className="page-note">
          Photograph the question paper, then say what subject it is and which
          exam. The photos are private to the processing team.
        </p>
      </div>

      <div className="page-body">
        <div className="form-block">
          <form
            onSubmit={submit}
            noValidate
            aria-labelledby="paper-upload-title"
          >
            <fieldset
              ref={photosRef}
              className="paper-photos"
              tabIndex={-1}
              aria-describedby={
                error && invalidField === "photos"
                  ? "paper-photos-hint paper-form-error"
                  : "paper-photos-hint"
              }
            >
              <legend>Photos of the paper</legend>
              <p className="hint-line" id="paper-photos-hint">
                Up to {MAX_PAPER_PAGES} pages, 5 MB each. PNG, JPEG or WebP.
              </p>
              <ImagePicker
                files={files}
                onChange={setFiles}
                disabled={sending}
                maxFiles={MAX_PAPER_PAGES}
                maxBytes={MAX_PAPER_FILE_BYTES}
                addLabel="Add pages"
                noun="page"
                hint={`Up to ${MAX_PAPER_PAGES} · 5 MB each`}
              />
            </fieldset>

            <label className="field">
              <span>Subject</span>
              <input
                ref={subjectRef}
                name="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  if (invalidField === "subject") setInvalidField(null);
                }}
                placeholder="DBMS"
                maxLength={60}
                required
                autoComplete="off"
                enterKeyHint="next"
                aria-invalid={invalidField === "subject"}
                aria-describedby={
                  invalidField === "subject" ? "paper-form-error" : undefined
                }
              />
            </label>

            <label className="field">
              <span>Exam</span>
              <input
                ref={examRef}
                name="exam"
                value={exam}
                onChange={(e) => {
                  setExam(e.target.value);
                  if (invalidField === "exam") setInvalidField(null);
                }}
                placeholder="Mid 1, 2026"
                maxLength={60}
                required
                autoComplete="off"
                enterKeyHint="next"
                aria-invalid={invalidField === "exam"}
                aria-describedby={
                  invalidField === "exam" ? "paper-form-error" : undefined
                }
              />
            </label>

            <label className="field">
              <span>Note (optional)</span>
              <textarea
                ref={noteRef}
                name="note"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (invalidField === "note") setInvalidField(null);
                }}
                rows={3}
                maxLength={240}
                placeholder="Regulation, branch, or anything the processing team should know."
                aria-invalid={invalidField === "note"}
                aria-describedby={
                  invalidField === "note" ? "paper-form-error" : undefined
                }
              />
              <span className="char-count">{note.length}/240</span>
            </label>

            {error && (
              <p
                className="note note--err mt-4"
                id="paper-form-error"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="btn-row mt-5">
              <button type="submit" className="btn-ink" disabled={sending}>
                {sending ? "Adding..." : "Add to the collection"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
