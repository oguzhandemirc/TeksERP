import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UPDATE_CHECK_INTERVAL_LABEL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
} from "@shared/update-schedule";

/**
 * GÜNCELLEME KONTROL RİTMİ — TEK ZAMANLAYICI, TEK KAYNAK (2026-09-04).
 *
 * ⭐ İDDİA: periyot 15 dakikadır, değeri `@shared/update-schedule` söyler ve
 * zamanlayıcı YALNIZ main process'te (bir tane) kurulur. Arayüz güncelleme için
 * kendi takvimini kurmaz — kurarsa aynı ritim pencere/mount sayısı kadar
 * çoğalır ve yayın sunucusuna N kat istek gider.
 *
 * ⭐ NEDEN METİN TARAMASI: zamanlayıcının kurulduğu yer main process'tir;
 * jsdom'da `registerUpdaterIpc` koşturulamaz (electron modülü). "Sayı doğru mu"
 * gerçek sabitle ölçülür (import), "ikinci zamanlayıcı doğdu mu" kaynak
 * taramasıyla.
 */
const oku = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const yorumsuz = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const ipcSrc = oku("electron/ipc/updater.ipc.ts");
const ipc = yorumsuz(ipcSrc);
const dugme = yorumsuz(oku("src/components/layout/GuncellemeDugmesi.tsx"));
const girisHook = yorumsuz(oku("src/hooks/useGirisGuncellemeKontrolu.ts"));
const hook = yorumsuz(oku("src/hooks/useUpdater.ts"));

describe("güncelleme kontrol ritmi", () => {
  it("periyot 15 dakika (2026-09-04 kararı; eskiden 4 saat)", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(UPDATE_CHECK_INTERVAL_LABEL).toBe("15 dakikada bir");
    expect(UPDATE_FIRST_CHECK_DELAY_MS).toBe(30_000);
  });

  it("main process periyodu KAYNAKTAN okur — yerel sayı literali yok", () => {
    expect(ipc).toContain("UPDATE_CHECK_INTERVAL_MS");
    expect(ipc).toContain("UPDATE_FIRST_CHECK_DELAY_MS");
    expect(ipc).toContain('from "@shared/update-schedule"');
    // Eski 4 saatlik literal (ve her türlü saat-ölçekli aralık) geri sızmasın.
    expect(ipc).not.toMatch(/60\s*\*\s*60\s*\*\s*1000/);
  });

  it("⚠️ zamanlayıcı TEK: yalnız main process, yalnız bir setInterval", () => {
    expect(ipc.match(/setInterval\(/g) ?? []).toHaveLength(1);
    expect(ipc.match(/setTimeout\(/g) ?? []).toHaveLength(1);
    // Arayüz tarafı: düğme de, giriş tetiği de, hook da kendi takvimini kurmaz.
    for (const [ad, kod] of [
      ["GuncellemeDugmesi", dugme],
      ["useGirisGuncellemeKontrolu", girisHook],
      ["useUpdater", hook],
    ] as const) {
      expect(kod, `${ad} kendi zamanlayıcısını kurmamalı`).not.toMatch(/setInterval\(/);
      expect(kod, `${ad} kendi zamanlayıcısını kurmamalı`).not.toMatch(/setTimeout\(/);
    }
  });

  it("körlük zemini: dosyalar gerçekten okundu ve kontrol hâlâ bağlı", () => {
    expect(ipcSrc.length).toBeGreaterThan(3000);
    expect(ipc).toContain("checkForUpdates");
    expect(ipc).toMatch(/setInterval\(\s*\(\)\s*=>\s*void check\(\),\s*UPDATE_CHECK_INTERVAL_MS\)/);
  });
});
