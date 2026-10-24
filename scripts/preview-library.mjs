// Local preview of the library mini app: serves the built bundle and fakes
// the API with real data, so the UI can be looked at without a deploy.
//
// The subjects come from the committed catalogue and the units from the
// vector pages on disk, so the page count in the preview is always the page
// count actually served. Hard-coding it is how the practice section went
// missing from the preview once already.
import http from "http";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(REPO, "src/web/dist-library");
/** Vector pages: a folder per document, named `<code>-u<unit>`. */
const PAGES = process.env.PREVIEW_PAGES || path.join(REPO, "data/pages");
const PORT = Number(process.env.PREVIEW_PORT) || 8099;

const STUDENT = {
  rollNo: "23CS1042",
  name: "MURALI",
  yearSem: process.env.PREVIEW_SEM || "31",
  branch: "5",
  dept: process.env.PREVIEW_DEPT || "CSE",
  regulation: process.env.PREVIEW_REG || "R23",
};

// the same stamping the server does, from the same code
const { stampPage } = await import(
  path.join(REPO, "dist/services/library/watermark.js")
);
const { watermarkToken } = await import(
  path.join(REPO, "dist/services/library/watermark.js")
);
const PREVIEW_TOKEN = watermarkToken("123456789");

/** Every vector document on disk, keyed by document id. */
const documents = new Map();
/** code → unit documents, in unit order. */
const unitsByCode = new Map();

const unitLabel = (raw) => (/^\d+$/.test(raw) ? raw : raw.toUpperCase());

const scanPages = async () => {
  const entries = await readdir(PAGES, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory());
  const flat = entries.filter((e) => e.isFile() && e.name.endsWith(".svg"));

  if (dirs.length === 0 && flat.length > 0) {
    // a single document in a flat folder: one subject, one unit
    const files = flat.map((e) => path.join(PAGES, e.name)).sort();
    const doc = {
      id: "preview-doc",
      code: "PREVIEW",
      unit: null,
      files,
      title: "Preview material",
    };
    documents.set(doc.id, doc);
    unitsByCode.set(doc.code, [doc]);
    return;
  }

  for (const dir of dirs) {
    const files = (await readdir(path.join(PAGES, dir.name)))
      .filter((f) => f.endsWith(".svg"))
      .sort()
      .map((f) => path.join(PAGES, dir.name, f));
    if (files.length === 0) continue;

    const m = /^(.*)-u([0-9ivx]+)$/i.exec(dir.name);
    const code = m ? m[1].toUpperCase() : dir.name.toUpperCase();
    const unit = m ? unitLabel(m[2]) : null;
    const doc = { id: dir.name, code, unit, files, title: null };
    documents.set(doc.id, doc);
    const list = unitsByCode.get(code) ?? [];
    list.push(doc);
    unitsByCode.set(code, list);
  }

  // units in reading order: I, II, III, then anything unnumbered
  for (const list of unitsByCode.values()) {
    list.sort((a, b) => (a.unit ?? "z").localeCompare(b.unit ?? "z"));
  }
};

const buildSubjects = async () => {
  const catalogue = JSON.parse(
    await readFile(path.join(REPO, "data/syllabus-catalog.json"), "utf8"),
  );
  const dept = catalogue.departments[STUDENT.dept];
  const sem = dept?.[STUDENT.regulation]?.[STUDENT.yearSem];
  const listed = [...(sem?.core ?? []), ...(sem?.elective ?? [])];

  const known = new Set(listed.map((s) => s.code));
  const subjects = listed.map((s) => {
    const units = unitsByCode.get(s.code) ?? [];
    for (const unit of units) unit.title = s.name;
    return {
      code: s.code,
      name: s.name,
      live: units.length > 0,
      units: units.map((u) => ({
        id: u.id,
        unit: u.unit,
        pages: u.files.length,
      })),
    };
  });

  // pages whose subject is not in the catalogue still deserve a row
  for (const [code, units] of unitsByCode) {
    if (known.has(code)) continue;
    for (const unit of units) unit.title = code;
    subjects.push({
      code,
      name: code,
      live: true,
      units: units.map((u) => ({
        id: u.id,
        unit: u.unit,
        pages: u.files.length,
      })),
    });
  }

  return subjects;
};

await scanPages();
const SUBJECTS = {
  ok: true,
  student: STUDENT,
  subjects: await buildSubjects(),
};

const totalDocs = documents.size;
console.log(`preview: ${totalDocs} document(s) from ${PAGES}`);
for (const subject of SUBJECTS.subjects.filter((s) => s.live)) {
  console.log(
    `  ${subject.code} ${subject.name}: ` +
      subject.units.map((u) => `${u.unit ?? "full"} (${u.pages}p)`).join(", "),
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const stamped = new Map();

/**
 * The real app only opens inside Telegram, because the signed initData is
 * the way in. For a look in a plain browser the preview stands in for
 * Telegram: it fakes the user and the API, so every screen is reachable.
 */
const TELEGRAM_STUB = `<script>
  (() => {
    let sdk = null;
    const fake = {
      initData: "preview",
      initDataUnsafe: { user: { id: 123456789, first_name: "Murali" } },
      ready() {}, setHeaderColor() {}, setBackgroundColor() {}, expand() {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
    };
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      get: () => ({ WebApp: Object.assign({}, sdk && sdk.WebApp, fake) }),
      set: (v) => { sdk = v; },
    });
  })();
</script>`;

const serveFile = async (res, file) => {
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
};

const sendJson = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/api/library/session") {
    return sendJson(res, { ok: true, registered: true, student: STUDENT });
  }
  if (p === "/api/library/subjects") {
    return sendJson(res, SUBJECTS);
  }
  if (p.startsWith("/api/library/page/")) {
    const [, , , , docId, pageRaw] = p.split("/");
    const page = Number(pageRaw);
    const doc = documents.get(docId);
    if (!doc)
      return sendJson(res, { ok: false, error: "no such document" }, 404);
    if (!Number.isInteger(page) || page < 1 || page > doc.files.length) {
      return sendJson(res, { ok: false, error: "no such page" }, 404);
    }

    const key = `${docId}:${page}`;
    if (!stamped.has(key)) {
      const svg = await stampPage(doc.files[page - 1], {
        token: PREVIEW_TOKEN,
        label: `${doc.title}${doc.unit ? ` · Unit ${doc.unit}` : ""} · p${page}`,
      });
      stamped.set(key, svg);
    }
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store, private",
    });
    return res.end(stamped.get(key));
  }

  if (p === "/" || p === "/library" || p === "/library/") {
    const html = await readFile(path.join(WEB, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    return res.end(html.replace("</head>", `${TELEGRAM_STUB}\n</head>`));
  }
  if (p.startsWith("/library/")) {
    return serveFile(res, path.join(WEB, p.replace("/library/", "")));
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () =>
  console.log(`library preview on http://localhost:${PORT}/library/`),
);
