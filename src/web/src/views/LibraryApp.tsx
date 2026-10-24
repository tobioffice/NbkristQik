import { useState } from "react";
import Band from "../components/Band";
import { useTelegramIdentity } from "../useTelegramIdentity";
import { useLibrary } from "../useLibrary";
import { registerLibraryRoll, type LibrarySubject } from "../libraryApi";
import DocumentReader from "./DocumentReader";

/**
 * The library mini app.
 *
 * Three states, in order:
 *   gate  — no Telegram context. Nothing is fetched, nothing is shown.
 *   paper — signed in, but no roll number saved: ask for one.
 *   shelf — signed in with a roll number: the subjects of the running
 *           semester, and what we hold of each.
 */
export default function LibraryApp() {
  const { initData } = useTelegramIdentity();

  // outside Telegram there is nothing to load and nothing to show
  if (!initData) {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub="Library" />
          <div className="form-wrap">
            <div className="form-block">
              <h1 className="form-title form-title--lg">Open it from Telegram</h1>
              <p className="form-note">
                The library is only for NbkristQik bot users. Open the bot and
                tap Library, and it will open here.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <LibraryShelf initData={initData} />;
}

interface OpenUnit {
  id: string;
  title: string;
  unit: string | null;
  pages: number;
}

function LibraryShelf({ initData }: { initData: string }) {
  const { status, retry, setView } = useLibrary(initData);
  const [subject, setSubject] = useState<LibrarySubject | null>(null);
  const [unit, setUnit] = useState<OpenUnit | null>(null);

  if (status.state === "loading") {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub="Library" />
          <div className="form-wrap">
            <div className="form-block" aria-hidden="true">
              <div className="sk" style={{ height: 44, marginTop: 22 }} />
              <div className="sk" style={{ height: 44, marginTop: 12 }} />
              <div className="sk" style={{ height: 44, marginTop: 12 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub="Library" />
          <div className="form-wrap">
            <div className="form-block">
              <h1 className="form-title form-title--lg">The library stayed shut</h1>
              <p className="form-note">{status.message}</p>
            </div>
            <button className="btn-ink w-full mt-5" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.state === "unregistered") {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub="Library" />
          <div className="form-wrap">
            <div className="form-block">
              <h1 className="form-title form-title--lg">Save your roll number</h1>
              <p className="form-note">
                The library shows the subjects of your year and branch. Save
                your roll number once and it opens straight away.
              </p>
            </div>
            <RollForm initData={initData} onSaved={retry} />
          </div>
        </div>
      </div>
    );
  }

  // a unit is open: the reader takes the whole screen
  if (unit) {
    return (
      <DocumentReader
        docId={unit.id}
        title={unit.title}
        unit={unit.unit}
        pages={unit.pages}
        onClose={() => setUnit(null)}
      />
    );
  }

  // a subject is open: the list of its units
  if (subject) {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub={subject.code} />
          <div className="form-wrap">
            <div className="form-block">
              <h1 className="form-title form-title--lg">{subject.name}</h1>
              <p className="form-note">
                {`${subject.code} · ${subject.units.length} unit${
                  subject.units.length === 1 ? "" : "s"
                }`}
              </p>
            </div>
            <div className="list-head lib-list-head lib-list-head--units">
              <span>Unit</span>
              <span>Pages</span>
            </div>
            {subject.units.map((u) => (
              <button
                className="lib-row lib-row--open lib-row--units"
                key={u.id}
                onClick={() =>
                  setUnit({
                    id: u.id,
                    title: subject.name,
                    unit: u.unit,
                    pages: u.pages,
                  })
                }
              >
                <span className="lib-row__name">
                  {u.unit ? `Unit ${u.unit}` : "Full subject"}
                </span>
                <span className="lib-row__state lib-row__state--live">
                  {`${u.pages} page${u.pages === 1 ? "" : "s"}`}
                </span>
              </button>
            ))}
            <button
              className="btn-outline w-full mt-5"
              onClick={() => setSubject(null)}
            >
              All subjects
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { student, subjects } = status;
  const live = subjects.filter((s) => s.live).length;

  return (
    <div className="app">
      <div className="sheet">
        <Band
          sub="Library"
          stamp={{ value: String(live), label: "ready to read" }}
        />
        <div className="form-wrap">
          <div className="form-block">
            <h1 className="form-title form-title--lg">
              {status.preview ? "Everything on the shelf" : "Your subjects"}
            </h1>
            <p className="form-note">
              {`${student.rollNo} · ${student.dept ?? "—"} · year ${
                student.yearSem[0]
              }, semester ${student.yearSem[1]}`}
            </p>
            {status.preview ? (
              <p className="form-note">
                Admin preview · not what this roll sees.
              </p>
            ) : null}
          </div>

          {subjects.length === 0 ? (
            <p className="form-note">
              Nothing for your semester yet. I'll message you in the bot when
              it's ready.
            </p>
          ) : (
            <>
              <div className="list-head lib-list-head">
                <span>Code</span>
                <span>Subject</span>
                <span>State</span>
              </div>
              {subjects.map((item) =>
                item.live ? (
                  <button
                    className="lib-row lib-row--open"
                    key={item.code}
                    onClick={() => setSubject(item)}
                  >
                    <span className="lib-row__code">{item.code}</span>
                    <span className="lib-row__name">{item.name}</span>
                    <span className="lib-row__state lib-row__state--live">
                      {`${item.units.length} unit${
                        item.units.length === 1 ? "" : "s"
                      } ›`}
                    </span>
                  </button>
                ) : (
                  <div className="lib-row" key={item.code}>
                    <span className="lib-row__code">{item.code}</span>
                    <span className="lib-row__name">{item.name}</span>
                    <span className="lib-row__state">not yet</span>
                  </div>
                ),
              )}
            </>
          )}

          {status.admin ? (
            <div className="form-block">
              <button
                className="btn-outline w-full"
                onClick={() => setView(status.preview ? "roll" : "all")}
              >
                {status.preview
                  ? `Show what ${student.rollNo} sees`
                  : "Show everything on the shelf"}
              </button>
            </div>
          ) : null}
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerLibraryRoll(initData, rollNo.trim().toUpperCase());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
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
          onChange={(e) => setRollNo(e.target.value)}
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
