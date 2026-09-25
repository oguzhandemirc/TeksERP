import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSackDumpHtml } from "./dumpHtml";
import { dumpKombinasyonlari, SABIT_AN } from "./__tests__/dumpFixtures";

/**
 * Çuval İçerik Dökümü PDF'inin (HTML) ALTIN KOPYASI — görünüm bilinçsiz değişmesin.
 * Bilinçli bir değişiklikte kırmızıya düşer: çıktıyı gözle doğrula, sonra
 * `ALTIN_YAZ=1 npx vitest run <bu dosya>` ile yenile ve commit mesajına NEDEN'ini yaz.
 * Karşılaştırma boşluk normalizasyonu dışında bayt bayt; basım anı sabit.
 */
const ALTIN = resolve(__dirname, "dumpHtml.altin.json");
const sha = (s: string) => createHash("sha256").update(s.replace(/\s+/g, " ").trim()).digest("hex");

describe("Çuval İçerik Dökümü HTML — altın kopya", () => {
  const gercek = Object.fromEntries(dumpKombinasyonlari().map((k) => [k.ad, sha(buildSackDumpHtml(k.dumps, k.opts, SABIT_AN))]));

  if (process.env.ALTIN_YAZ === "1") {
    it("altın yazıldı", () => {
      writeFileSync(ALTIN, `${JSON.stringify(gercek, null, 1)}\n`);
    });
    return;
  }

  it("körlük zemini: kombinasyonlar farklı çıktılar üretiyor", () => {
    expect(Object.keys(gercek).length).toBeGreaterThanOrEqual(18);
    expect(new Set(Object.values(gercek)).size).toBeGreaterThanOrEqual(15);
  });

  it("altın dosya ↔ kombinasyon uzayı iki yönlü ve her HTML altınla aynı", () => {
    expect(existsSync(ALTIN)).toBe(true);
    const altin = JSON.parse(readFileSync(ALTIN, "utf8")) as Record<string, string>;
    expect(Object.keys(altin).sort()).toEqual(Object.keys(gercek).sort());
    const degisen = Object.keys(gercek).filter((k) => altin[k] !== gercek[k]);
    expect(degisen).toEqual([]);
  });
});
