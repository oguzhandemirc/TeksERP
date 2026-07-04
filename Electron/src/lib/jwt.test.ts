import { describe, it, expect } from "vitest";
import { decodeJwt, jwtExpiryMs, jwtPayloadExpiryMs } from "./jwt";

/** Test amaçlı base64url (padding'siz) JWT üret — imza doğrulanmaz, sadece decode. */
function makeToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

describe("decodeJwt", () => {
  it("geçerli token'ın payload'ını çözer (jti/exp dahil)", () => {
    const token = makeToken({
      userId: "u1",
      username: "admin",
      permissions: ["admin:*"],
      jti: "sess-1",
      exp: 1_900_000_000,
    });
    const decoded = decodeJwt(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe("u1");
    expect(decoded?.jti).toBe("sess-1");
    expect(decoded?.exp).toBe(1_900_000_000);
  });

  it("bozuk/eksik token → null", () => {
    expect(decodeJwt("notatoken")).toBeNull();
    expect(decodeJwt("")).toBeNull();
    expect(decodeJwt("a.!!!.c")).toBeNull();
  });
});

describe("jwtExpiryMs / jwtPayloadExpiryMs", () => {
  it("exp (saniye) → ms epoch'a çevrilir", () => {
    const token = makeToken({ userId: "u", username: "u", permissions: [], exp: 1_800_000_000 });
    expect(jwtExpiryMs(token)).toBe(1_800_000_000_000);
  });

  it("exp yoksa null", () => {
    const token = makeToken({ userId: "u", username: "u", permissions: [] });
    expect(jwtExpiryMs(token)).toBeNull();
  });

  it("çözülemeyen token → null", () => {
    expect(jwtExpiryMs("garbage")).toBeNull();
  });

  it("payload helper: sayısal olmayan/eksik exp → null", () => {
    expect(jwtPayloadExpiryMs(null)).toBeNull();
    expect(jwtPayloadExpiryMs({})).toBeNull();
    expect(jwtPayloadExpiryMs({ exp: Number.NaN })).toBeNull();
    expect(jwtPayloadExpiryMs({ exp: 1000 })).toBe(1_000_000);
  });
});
