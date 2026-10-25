import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorCode, costMissingFromError, isModuleDisabled } from "./errors";

const err = (status: number, data: unknown) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } });

describe("maliyet hata okuma — kod YALNIZ details.code", () => {
  it("403 MODULE_DISABLED → kapalı modül", () => {
    expect(isModuleDisabled(err(403, { details: { code: "MODULE_DISABLED" } }))).toBe(true);
    expect(isModuleDisabled(err(403, { message: "yetki yok" }))).toBe(false);
  });
  it("body.code okunmaz", () => {
    expect(apiErrorCode(err(400, { code: "COST_INPUT_MISSING" }))).toBeNull();
  });
  it("COST_INPUT_MISSING → details.missing[]", () => {
    expect(costMissingFromError(err(400, { details: { code: "COST_INPUT_MISSING", missing: ["FX_RATE_MISSING", 3] } }))).toEqual(["FX_RATE_MISSING"]);
    expect(costMissingFromError(err(409, { details: { code: "COST_VERSION_CONFLICT" } }))).toBeNull();
  });
});
