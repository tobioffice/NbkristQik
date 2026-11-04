import { describe, it, expect } from "vitest";
import { buildLoginPayload } from "../../src/services/student.utils/portalSession.js";

describe("buildLoginPayload", () => {
  it("form-encodes credentials that contain reserved characters", () => {
    const payload = buildLoginPayload("user+name@example.com", "p&ss=w%rd+ 1");
    const params = new URLSearchParams(payload);

    expect(params.get("username")).toBe("user+name@example.com");
    expect(params.get("password")).toBe("p&ss=w%rd+ 1");
    expect(params.get("captcha")).toBe("");
    // no raw & / = from the password can split the body
    expect(payload.split("&")).toHaveLength(3);
  });

  it("uses the configured credentials by default", () => {
    const params = new URLSearchParams(buildLoginPayload());

    expect(params.get("username")).toBe("test_user");
    expect(params.get("password")).toBe("test_pass");
  });
});
