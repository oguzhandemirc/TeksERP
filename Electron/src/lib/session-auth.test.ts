import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import {
  autoLogoutDelayMs,
  MAX_TIMER_MS,
  SAME_TYPE_SESSION_POLICY_OPTIONS,
  DEFAULT_SAME_TYPE_SESSION_POLICY,
  sessionPolicyLabel,
  isSameTypeSessionPolicy,
  readSessionConflict,
} from "./session-auth";

describe("autoLogoutDelayMs", () => {
  it("gelecekteki exp → kalan süre (ms)", () => {
    expect(autoLogoutDelayMs(10_000, 4_000)).toBe(6_000);
  });
  it("geçmiş/eşit exp → 0 (hemen çıkış)", () => {
    expect(autoLogoutDelayMs(1_000, 1_000)).toBe(0);
    expect(autoLogoutDelayMs(500, 1_000)).toBe(0);
  });
  it("exp yok → null (zamanlayıcı kurma)", () => {
    expect(autoLogoutDelayMs(null, 1_000)).toBeNull();
  });
  it("32-bit setTimeout sınırını aşan uzak tarih kırpılır", () => {
    const far = Date.now() + MAX_TIMER_MS * 3;
    expect(autoLogoutDelayMs(far, Date.now())).toBe(MAX_TIMER_MS);
  });
});

describe("same-type oturum politikası select eşlemesi", () => {
  it("üç politika seçeneği doğru değer/etiketle listelenir", () => {
    expect(SAME_TYPE_SESSION_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      "kick",
      "notify",
      "off",
    ]);
  });
  it("değer → etiket eşlemesi (label<->value)", () => {
    expect(sessionPolicyLabel("kick")).toMatch(/eskiyi düşür/i);
    expect(sessionPolicyLabel("notify")).toMatch(/bildir/i);
    expect(sessionPolicyLabel("off")).toMatch(/sınırsız/i);
  });
  it("default politika 'kick'", () => {
    expect(DEFAULT_SAME_TYPE_SESSION_POLICY).toBe("kick");
  });
  it("guard geçerli değerleri kabul, geçersizleri reddeder", () => {
    expect(isSameTypeSessionPolicy("kick")).toBe(true);
    expect(isSameTypeSessionPolicy("notify")).toBe(true);
    expect(isSameTypeSessionPolicy("off")).toBe(true);
    expect(isSameTypeSessionPolicy("bogus")).toBe(false);
    expect(isSameTypeSessionPolicy(undefined)).toBe(false);
    expect(isSameTypeSessionPolicy(null)).toBe(false);
  });
});

describe("readSessionConflict (409 SESSION_EXISTS dedektörü)", () => {
  function conflictError(details: unknown, status = 409): AxiosError {
    const err = new AxiosError("conflict", "ERR_BAD_REQUEST");
    err.config = { headers: new AxiosHeaders() } as never;
    err.response = {
      data: { success: false, message: "açık", details },
      status,
      statusText: "",
      headers: {},
      config: err.config,
    } as AxiosResponse;
    return err;
  }

  it("SESSION_EXISTS + existingSession → oturum bilgisini döndürür", () => {
    const info = { deviceType: "electron", createdAt: "2026-07-05T10:00:00Z", deviceId: "pc-1" };
    const result = readSessionConflict(conflictError({ code: "SESSION_EXISTS", existingSession: info }));
    expect(result).toEqual(info);
  });

  it("existingSession yoksa güvenli fallback döndürür (yine de dialog açılır)", () => {
    const result = readSessionConflict(conflictError({ code: "SESSION_EXISTS" }));
    expect(result).not.toBeNull();
    expect(result?.deviceType).toBe("electron");
  });

  it("409 ama farklı kod → null", () => {
    expect(readSessionConflict(conflictError({ code: "OTHER" }))).toBeNull();
  });

  it("409 ama details yok → null", () => {
    expect(readSessionConflict(conflictError(undefined))).toBeNull();
  });

  it("409 dışı statü → null", () => {
    expect(readSessionConflict(conflictError({ code: "SESSION_EXISTS" }, 401))).toBeNull();
  });

  it("axios olmayan/yanıtsız hata → null", () => {
    expect(readSessionConflict(new Error("boom"))).toBeNull();
    expect(readSessionConflict(undefined)).toBeNull();
  });
});
