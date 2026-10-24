import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  classifySection,
  parseRegulationLabel,
  parseSubjectLink,
  parseSyllabusPage,
  yearSemFromHref,
} from "../../src/services/library/syllabusParser.js";

/**
 * A trimmed copy of the college's real syllabus markup: one regulation, two
 * semesters, a CORE block and an elective block. The shape that matters is
 * the nesting (card → card-header + card-body pairs) and the two subject
 * link forms.
 */
const FIXTURE = `
<div class="container"><div id="accordion">
  <div class="card">
    <div class="card-header" id="heading1">
      <h2 class="accordion-header"><button data-bs-target="#collapse1">B.Tech - R23 Regulations</button></h2>
    </div>
    <div id="collapse1" class="accordion-collapse collapse show">
      <div class="card-body" id="child1">
        <div>
          <div class="card-header"><a href="#" data-bs-target="#c1"><font size=5>I Year - I Sem</font></a></div>
          <div class="card-body accordion-collapse collapse show" id="c1">
            <a href='R23 Regulations/B.Tech/CSE/11/23BS11T2-CHEMISTRY.pdf'>( 23BS11T2 ) Chemistry.pdf</a><BR>
            <a href='R23 Regulations/B.Tech/CSE/11/23ES11T1 &ndash; PROGRAMMING.pdf'>( 23ES11T1 )  Introduction To Programming.pdf</a><BR>
          </div>
        </div>
        <div>
          <div class="card-header"><a href="#" data-bs-target="#c2"><font size=5>II Year - II Sem</font></a></div>
          <div class="card-body accordion-collapse collapse" id="c2">
            <a href='R23 Regulations/B.Tech/CSE/22/23AD22T1 &ndash; DATABASE MANAGEMENT SYSTEMS.pdf'>( 23AD22T1 )  Database Management Systems.pdf</a><BR>
            <a href='R23 Regulations/B.Tech/CSE/22/23CS22SC - FULL STACK DEVELOPMENT &ndash; 1.pdf'>( 23CS22SC )  Full Stack Development - 1.pdf</a><BR>
          </div>
        </div>
        <div>
          <div class="card-header"><a href="#" data-bs-target="#c3"><font size=5>CORE</font></a></div>
          <div class="card-body accordion-collapse collapse" id="c3">
            <a href='R23 Regulations/B.Tech/CSE/22/CORE/23ES22MC &ndash;TECHNICAL PAPER WRITING.pdf'>( 23ES22MC ) Technical Paper Writing &amp; Ipr.pdf</a><BR>
          </div>
        </div>
        <div>
          <div class="card-header"><a href="#" data-bs-target="#c4"><font size=5>OE-2</font></a></div>
          <div class="card-body accordion-collapse collapse" id="c4">
            <a href='R23 Regulations/B.Tech/CSE/22/OE-2/23CS22O1&ndash; OPERATING SYSTEMS.pdf'>( OE ) 23cs22o1- Operating Systems.pdf</a><BR>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header" id="heading2">
      <h2 class="accordion-header"><button data-bs-target="#collapse2">M.Tech - 2013 Regulations</button></h2>
    </div>
    <div id="collapse2" class="accordion-collapse collapse">
      <div class="card-body">
        <div>
          <div class="card-header"><a href="#"><font size=5>I Year - I Sem</font></a></div>
          <div class="card-body">
            <a href='MTech/B.Tech/PS/11/1_ADVANCED DATA STRUCTURES.DOCX'>1_ADVANCED DATA STRUCTURES.DOCX</a><BR>
          </div>
        </div>
      </div>
    </div>
  </div>
</div></div>
`;

describe("regulation labels", () => {
  it("reads the scheme code from a modern label", () => {
    expect(parseRegulationLabel("B.Tech - R23 Regulations")).toEqual({
      degree: "B.Tech",
      regulation: "R23",
    });
  });

  it("turns a year into a scheme code", () => {
    expect(parseRegulationLabel("B.Tech - 2020 Regulations")).toEqual({
      degree: "B.Tech",
      regulation: "R20",
    });
    expect(parseRegulationLabel("M.Tech - 2013 Regulations")).toEqual({
      degree: "M.Tech",
      regulation: "R13",
    });
  });

  it("rejects a label that names no scheme", () => {
    expect(parseRegulationLabel("Some other card")).toBeNull();
  });
});

describe("section headers", () => {
  it("turns a semester header into the college year-sem code", () => {
    expect(classifySection("I Year - I Sem")).toEqual({
      kind: "core",
      yearSem: "11",
      isSemester: true,
    });
    expect(classifySection("II Year - II Sem")).toEqual({
      kind: "core",
      yearSem: "22",
      isSemester: true,
    });
    expect(classifySection("IV Year - I Sem")).toEqual({
      kind: "core",
      yearSem: "41",
      isSemester: true,
    });
  });

  it("classifies the choice blocks", () => {
    expect(classifySection("CORE")).toEqual({
      kind: "core",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("CORE SUBJECTS")).toEqual({
      kind: "core",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("OE-2")).toEqual({
      kind: "elective",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("P-3")).toEqual({
      kind: "elective",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("MC-II")).toEqual({
      kind: "elective",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("PROFESSIONAL ELECTIVE-I")).toEqual({
      kind: "elective",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("OPEN ELECTIVE-II")).toEqual({
      kind: "elective",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("HONOURS")).toEqual({
      kind: "honours",
      yearSem: null,
      isSemester: false,
    });
    expect(classifySection("MINORS")).toEqual({
      kind: "minor",
      yearSem: null,
      isSemester: false,
    });
  });

  it("floats anything it cannot name", () => {
    expect(classifySection("Scheme")).toEqual({
      kind: "floating",
      yearSem: null,
      isSemester: false,
    });
  });

  it("reads the open elective lists other departments use", () => {
    expect(classifySection("Open Electives Offered by The Department")).toEqual(
      { kind: "elective", yearSem: null, isSemester: false },
    );
  });
});

describe("year-sem in a syllabus path", () => {
  it("reads the segment after the department", () => {
    expect(
      yearSemFromHref("R23 Regulations/B.Tech/CSE/31/23CS31T2 &ndash; X.pdf"),
    ).toBe("31");
  });

  it("returns null when the path has none", () => {
    expect(
      yearSemFromHref("R23 Regulations/B.Tech/CSE/Scheme R23 CSE SCHEME.PDF"),
    ).toBeNull();
    expect(yearSemFromHref(undefined)).toBeNull();
  });
});

describe("subject links", () => {
  it("reads the code and title from a regular subject", () => {
    const subject = parseSubjectLink(
      "( 23CS31T2 ) Computer Networks & Internet Protocols.pdf",
      "R23 Regulations/B.Tech/CSE/31/23CS31T2 &ndash; COMPUTER NETWORKS.pdf",
      "core",
    );
    expect(subject).toEqual({
      code: "23CS31T2",
      name: "Computer Networks & Internet Protocols",
      kind: "core",
      yearSem: "31",
    });
  });

  it("reads an elective, whose title carries the code twice", () => {
    const subject = parseSubjectLink(
      "( OE ) 23cs32o1- Operating Systems.pdf",
      "R23 Regulations/B.Tech/CSE/32/OE-2/23CS32O1&ndash; OPERATING SYSTEMS.pdf",
      "elective",
    );
    expect(subject).toEqual({
      code: "23CS32O1",
      name: "Operating Systems",
      kind: "elective",
      yearSem: "32",
    });
  });

  it("drops a link with no usable code", () => {
    expect(
      parseSubjectLink(
        "1_ADVANCED DATA STRUCTURES.DOCX",
        "MTech/x.docx",
        "core",
      ),
    ).toBeNull();
  });
});

describe("a department page", () => {
  const { regulations, skipped } = parseSyllabusPage(FIXTURE);

  it("finds both regulations", () => {
    expect(regulations.map((r) => r.regulation)).toEqual(["R23", "R13"]);
    expect(regulations[0].degree).toBe("B.Tech");
  });

  it("reads the core subjects of each semester", () => {
    const r23 = regulations[0];
    const first = r23.sections.find((s) => s.yearSem === "11");
    expect(first?.subjects.map((s) => s.code)).toEqual([
      "23BS11T2",
      "23ES11T1",
    ]);
  });

  it("puts the CORE block in the semester above it", () => {
    const r23 = regulations[0];
    const core = r23.sections.find((s) => s.label === "CORE");
    expect(core?.kind).toBe("core");
    expect(core?.subjects[0].code).toBe("23ES22MC");
    expect(core?.subjects[0].yearSem).toBe("22");
  });

  it("marks the elective block as elective", () => {
    const oe = regulations[0].sections.find((s) => s.label === "OE-2");
    expect(oe?.kind).toBe("elective");
    expect(oe?.subjects[0].name).toBe("Operating Systems");
  });

  it("counts the links it could not read", () => {
    expect(skipped).toBe(1);
  });
});

describe("building the catalogue", () => {
  const { catalog } = buildCatalog(
    [{ dept: "CSE", html: FIXTURE }],
    "2026-10-21T00:00:00.000Z",
  );

  it("keys by department, regulation and year-sem", () => {
    const cse = catalog.departments.CSE;
    expect(Object.keys(cse)).toEqual(["R23", "R13"]);
    expect(Object.keys(cse.R23)).toEqual(["11", "22"]);
  });

  it("separates core subjects from choices", () => {
    const yearSem = catalog.departments.CSE.R23["22"];
    expect(yearSem.core.map((s) => s.code)).toEqual([
      "23AD22T1",
      "23CS22SC",
      "23ES22MC",
    ]);
    expect(yearSem.elective.map((s) => s.code)).toEqual(["23CS22O1"]);
  });
});

describe("electives listed inside a semester", () => {
  const semester = `
    <div class="card-header"><h2><button>B.Tech - R23 Regulations</button></h2></div>
    <div class="card-body">
      <div>
        <div class="card-header"><a href="#"><font size=5>III Year - I Sem</font></a></div>
        <div class="card-body">
          <a href='R23 Regulations/B.Tech/CSE/31/23CS31T1 – AI.pdf'>( 23CS31T1 ) Artificial Intelligence.pdf</a><BR>
          <a href='R23 Regulations/B.Tech/CSE/31/23CS31E1 – OOAD.pdf'>( 23CS31E1 ) Object Oriented Analysis And Design.pdf</a><BR>
          <a href='R23 Regulations/B.Tech/CSE/31/23CS31O1 – JAVA.pdf'>( 23CS31O1 ) Java Programming.pdf</a><BR>
        </div>
      </div>
    </div>
  `;

  const { catalog } = buildCatalog(
    [{ dept: "CSE", html: semester }],
    "2026-10-21T00:00:00.000Z",
  );

  it("keeps the choices out of the core list", () => {
    const yearSem = catalog.departments.CSE.R23["31"];
    expect(yearSem.core.map((s) => s.code)).toEqual(["23CS31T1"]);
    expect(yearSem.elective.map((s) => s.code)).toEqual([
      "23CS31E1",
      "23CS31O1",
    ]);
  });
});
