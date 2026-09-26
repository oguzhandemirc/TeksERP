// Deneme token'ı durum makinesi — kk1.md "İstemci token'ı": belirsiz hatada yapışır, kesin 4xx ve başarıda yenilenir.
import { describe, expect, it } from "vitest";
import { createAttemptToken, isAmbiguousFailure, tokenAfterFailure } from "./attemptToken";

const sayac = () => {
  let n = 0;
  return () => `t${++n}`;
};

describe("createAttemptToken", () => {
  it("aynı deneme boyunca token aynı kalır (her tıklamada üretilmez)", () => {
    const a = createAttemptToken(sayac());
    expect(a.token()).toBe("t1");
    expect(a.token()).toBe("t1");
  });

  it("belirsiz hata (ağ · zaman aşımı · 5xx) → token yapışır", () => {
    const a = createAttemptToken(sayac());
    const t = a.token();
    for (const e of [new Error("Network Error"), { code: "ECONNABORTED" }, { response: { status: 502 } }, { status: 500 }, null]) {
      a.onFailure(e);
      expect(a.token()).toBe(t);
    }
  });

  it("kesin 4xx → yeni deneme; başarı → yeni deneme; renew → yeni deneme", () => {
    const a = createAttemptToken(sayac());
    a.token();
    a.onFailure({ response: { status: 409 } });
    expect(a.token()).toBe("t2");
    a.onSuccess();
    expect(a.token()).toBe("t3");
    a.renew();
    expect(a.token()).toBe("t4");
  });

  it("alt kayıt token'ı anahtar başına tekil, denemeyle birlikte yenilenir", () => {
    const a = createAttemptToken(sayac());
    const x = a.keyed("satır-1#0");
    expect(a.keyed("satır-1#0")).toBe(x);
    expect(a.keyed("satır-1#1")).not.toBe(x);
    a.onFailure({ status: 503 });
    expect(a.keyed("satır-1#0")).toBe(x);
    a.onFailure({ response: { status: 400 } });
    expect(a.keyed("satır-1#0")).not.toBe(x);
  });
});

describe("isAmbiguousFailure / tokenAfterFailure", () => {
  it("axios (response.status) ve düz (status) biçimini okur; durum yoksa belirsiz", () => {
    expect(isAmbiguousFailure({ response: { status: 422 } })).toBe(false);
    expect(isAmbiguousFailure({ status: 404 })).toBe(false);
    expect(isAmbiguousFailure({ response: { status: 500 } })).toBe(true);
    expect(isAmbiguousFailure(new Error("timeout"))).toBe(true);
  });

  it("tokenAfterFailure aynı kuralı tek deneme için uygular", () => {
    expect(tokenAfterFailure("eski", { status: 504 }, () => "yeni")).toBe("eski");
    expect(tokenAfterFailure("eski", { status: 400 }, () => "yeni")).toBe("yeni");
  });
});
