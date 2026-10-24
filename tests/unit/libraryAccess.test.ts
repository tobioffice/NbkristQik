import { afterEach, describe, expect, it } from "vitest";
import {
  canOpenLibrary,
  libraryOpenToAll,
} from "../../src/services/library/access.js";
import { ADMIN_ID } from "../../src/config/environmentals.js";

// the suite runs with LIBRARY_ACCESS=all so the library tests can read
const original = process.env.LIBRARY_ACCESS;

afterEach(() => {
  if (original === undefined) delete process.env.LIBRARY_ACCESS;
  else process.env.LIBRARY_ACCESS = original;
});

describe("who may open the library", () => {
  it("is the admin only by default", () => {
    delete process.env.LIBRARY_ACCESS;
    expect(libraryOpenToAll()).toBe(false);
    expect(canOpenLibrary(ADMIN_ID)).toBe(true);
    expect(canOpenLibrary(String(ADMIN_ID))).toBe(true);
    expect(canOpenLibrary(111222333)).toBe(false);
  });

  it("is every registered student once it is opened", () => {
    process.env.LIBRARY_ACCESS = "all";
    expect(libraryOpenToAll()).toBe(true);
    expect(canOpenLibrary(111222333)).toBe(true);
  });

  it("reads the switch from the environment, ignoring case and spaces", () => {
    process.env.LIBRARY_ACCESS = " ALL ";
    expect(libraryOpenToAll()).toBe(true);

    process.env.LIBRARY_ACCESS = "admin";
    expect(libraryOpenToAll()).toBe(false);
  });
});
