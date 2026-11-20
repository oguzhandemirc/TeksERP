import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installRandomUuidPolyfill, uuidV4FromRandom } from "./crypto-polyfill";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fill = (a: Uint8Array) => {
  for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff;
  return a;
};

describe("crypto-polyfill", () => {
  it("getRandomValues'tan v4 UUID üretir", () => {
    expect(uuidV4FromRandom(fill)).toMatch(V4);
  });

  it("güvensiz bağlamda (randomUUID yok) tamamlar, her çağrı farklı", () => {
    const c = { getRandomValues: (a: Uint8Array) => globalThis.crypto.getRandomValues(a) } as unknown as Crypto;
    expect(installRandomUuidPolyfill(c)).toBe(true);
    const a = c.randomUUID();
    expect(a).toMatch(V4);
    expect(c.randomUUID()).not.toBe(a);
  });

  it("var olan randomUUID'yi ezmez", () => {
    const own = () => "00000000-0000-4000-8000-000000000000" as const;
    const c = { randomUUID: own, getRandomValues: fill } as unknown as Crypto;
    expect(installRandomUuidPolyfill(c)).toBe(false);
    expect(c.randomUUID).toBe(own);
  });

  it("main.tsx'in İLK importu polyfill (token üreten her modülden önce)", () => {
    const src = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const first = src.split("\n").find((l) => l.startsWith("import "));
    expect(first).toBe('import "./lib/crypto-polyfill";');
  });
});
