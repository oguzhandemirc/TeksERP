import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { needsApprovalError } from "./credentialResetService";

function apiError(status: number, code?: string): AxiosError {
  const err = new AxiosError("x");
  err.response = { status, data: { success: false, details: code ? { code } : undefined }, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
}

describe("needsApprovalError — onay talebi kutusu yalnız iki kişilik kapıda açılır", () => {
  it("CREDENTIAL_RESET_NEEDS_APPROVAL → true", () => {
    expect(needsApprovalError(apiError(403, "CREDENTIAL_RESET_NEEDS_APPROVAL"))).toBe(true);
  });
  it("düz yetki reddi ve başka hatalar → false", () => {
    expect(needsApprovalError(apiError(403, "PERMISSION_DENIED"))).toBe(false);
    expect(needsApprovalError(apiError(500))).toBe(false);
    expect(needsApprovalError(new Error("x"))).toBe(false);
    expect(needsApprovalError(null)).toBe(false);
  });
});
