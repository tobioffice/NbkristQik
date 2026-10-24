import { useState } from "react";
import { plural } from "../format";
import {
  registerLibraryRoll,
  type LibraryStudent,
  type LibrarySubject,
  type LibraryUnit,
} from "../libraryApi";
import { useBandStamp } from "../bandStamp";
import { useLibrary } from "../useLibrary";
import DocumentReader from "./DocumentReader";

/**
 * The shelf: the subjects of the reader's own semester, and what we hold.
 *
 * The shell owns the cloth band and the frame, so this view only prints its
 * contents and publishes the one figure the band shows — how many subjects
 * are ready. When a unit is opened the reader takes the whole screen and the
 * shell steps out of its way (`onImmersive`).
 */

interface LibraryViewProps {
  initData: string;
  /** True while the reader is open: the shell hides its chrome. */
  onImmersiveChange?: (immersive: boolean) => void;
}

/** A unit, once it is open: the reader needs the subject's name too. */
interface OpenUnit extends LibraryUnit {
  title: string;
}

export default function LibraryView({
  initData,
  onImmersiveChange,
}: LibraryViewProps) {
  const { status, retry, setView } = useLibrary(initData);
  const [subject, setSubject] = useState<LibrarySubject | null>(null);
  const [unit, setUnit] = useState<OpenUnit | null>(null);

  const closeUnit = () => {
    setUnit(null);
    onImmersiveChange?.(false);
  };

  const openUnit = (open: OpenUnit) => {
    setUnit(open);
    onImmersiveChange?.(true);
  };

  if (unit) {
    return (
      <DocumentReader
        docId={unit.id}
        title={unit.title}
        unit={unit.unit}
        pages={unit.pages}
        onClose={closeUnit}
      />
    );
  }

  if (status.state === "loading") return <ShelfLoading />;

  if (status.state === "error") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Shelf</p>
          <h2 className="page-title">The library stayed shut</h2>
          <p className="page-note">{status.message}</p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <button className="btn-ink w-full" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.state === "closed") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Shelf</p>
          <h2 className="page-title">The library opens soon</h2>
          <p className="page-note">
            I'm filling the shelf with your semester's units. I'll tell you in
            the bot the moment it's ready, and this page will open on its own.
          </p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <button className="btn-outline w-full" onClick={retry}>
              Check again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.state === "unregistered") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Shelf</p>
          <h2 className="page-title">Save your roll number</h2>
          <p className="page-note">
            The library shows the subjects of your year and branch. Save your
            roll number once and it opens straight away.
          </p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <RollForm initData={initData} onSaved={retry} />
          </div>
        </div>
      </div>
    );
  }

  if (subject) {
    return (
      <UnitList
        subject={subject}
        onOpen={(open) => openUnit({ ...open, title: subject.name })}
        onBack={() => setSubject(null)}
      />
    );
  }

  return (
    <Shelf
      student={status.student}
      subjects={status.subjects}
      preview={status.preview}
      onOpenSubject={setSubject}
      onSwitchView={
        status.admin
          ? () => setView(status.preview ? "roll" : "all")
          : undefined
      }
    />
  );
}

const ShelfLoading = () => (
  <div className="page" aria-hidden="true">
    <div className="page-body">
      <div className="form-block">
        <div className="sk" style={{ height: 52, marginTop: 6 }} />
        <div className="sk" style={{ height: 52, marginTop: 10 }} />
        <div className="sk" style={{ height: 52, marginTop: 10 }} />
      </div>
    </div>
  </div>
);

interface ShelfProps {
  student: LibraryStudent;
  subjects: LibrarySubject[];
  /** True when the list is the whole shelf, not the roll's semester */
  preview: boolean;
  onOpenSubject: (subject: LibrarySubject) => void;
  /** Only the admin has a second view to switch to. */
  onSwitchView?: () => void;
}

/** The shelf: every subject we hold for this reader. */
function Shelf({
  student,
  subjects,
  preview,
  onOpenSubject,
  onSwitchView,
}: ShelfProps) {
  const ready = subjects.filter((subject) => subject.live).length;
  useBandStamp({ value: String(ready), label: "ready to read" });

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">{preview ? "Admin preview" : "Shelf"}</p>
        <h2 className="page-title">
          {preview ? "Everything on the shelf" : "Your subjects"}
        </h2>
        <p className="page-note">
          {`${student.rollNo} · ${student.dept ?? "—"} · Year ${
            student.yearSem[0]
          }, semester ${student.yearSem[1]}`}
        </p>
      </div>

      <div className="page-body">
        {subjects.length === 0 ? (
          <div className="form-block">
            <p className="form-note">
              Nothing for your semester yet. I'll message you in the bot when
              it's ready.
            </p>
          </div>
        ) : (
          <SubjectList subjects={subjects} onOpen={onOpenSubject} />
        )}

        <div className="form-block mt-4">
          {preview ? (
            <p className="form-note">Admin preview · not what this roll sees.</p>
          ) : null}

          {onSwitchView ? (
            <button className="btn-outline w-full mt-4" onClick={onSwitchView}>
              {preview
                ? `Show what ${student.rollNo} sees`
                : "Show everything on the shelf"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const SubjectList = ({
  subjects,
  onOpen,
}: {
  subjects: LibrarySubject[];
  onOpen: (subject: LibrarySubject) => void;
}) => (
  <>
    <div className="list-head lib-list-head">
      <span>Code</span>
      <span>Subject</span>
      <span>State</span>
    </div>
    {subjects.map((subject) => (
      <SubjectRow key={subject.code} subject={subject} onOpen={onOpen} />
    ))}
  </>
);

/** A held subject opens; a subject we have nothing for says so, quietly. */
const SubjectRow = ({
  subject,
  onOpen,
}: {
  subject: LibrarySubject;
  onOpen: (subject: LibrarySubject) => void;
}) => {
  const name = <span className="lib-row__name">{subject.name}</span>;
  const code = <span className="lib-row__code">{subject.code}</span>;

  if (!subject.live) {
    return (
      <div className="lib-row">
        {code}
        {name}
        <span className="lib-row__state">not yet</span>
      </div>
    );
  }

  return (
    <button className="lib-row lib-row--open" onClick={() => onOpen(subject)}>
      {code}
      {name}
      <span className="lib-row__state lib-row__state--live">
        {`${plural(subject.units.length, "unit")} ›`}
      </span>
    </button>
  );
};

/** One subject: the units we hold of it. */
function UnitList({
  subject,
  onOpen,
  onBack,
}: {
  subject: LibrarySubject;
  onOpen: (unit: LibraryUnit) => void;
  onBack: () => void;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">{subject.code}</p>
        <h2 className="page-title">{subject.name}</h2>
        <p className="page-note">{plural(subject.units.length, "unit")}</p>
      </div>

      <div className="page-body">
        <div className="list-head lib-list-head lib-list-head--units">
          <span>Unit</span>
          <span>Pages</span>
        </div>
        {subject.units.map((unit) => (
          <button
            className="lib-row lib-row--open lib-row--units"
            key={unit.id}
            onClick={() => onOpen(unit)}
          >
            <span className="lib-row__name">
              {unit.unit ? `Unit ${unit.unit}` : "Full subject"}
            </span>
            <span className="lib-row__state lib-row__state--live">
              {plural(unit.pages, "page")}
            </span>
          </button>
        ))}

        <div className="form-block">
          <button className="btn-outline w-full mt-5" onClick={onBack}>
            All subjects
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The roll number form. Posts to the same registration endpoint the profile
 * page uses, so a student registered here is registered everywhere.
 */
function RollForm({
  initData,
  onSaved,
}: {
  initData: string;
  onSaved: () => void;
}) {
  const [rollNo, setRollNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerLibraryRoll(initData, rollNo.trim().toUpperCase());
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="lib-form" onSubmit={submit}>
      <label className="field">
        <span>Roll number</span>
        <input
          value={rollNo}
          onChange={(event) => setRollNo(event.target.value)}
          placeholder="23CS1042"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
        />
      </label>
      {error ? <div className="note note--err mt-4">{error}</div> : null}
      <button className="btn-ink w-full mt-5" type="submit" disabled={busy}>
        {busy ? "Saving" : "Save and open"}
      </button>
    </form>
  );
}
