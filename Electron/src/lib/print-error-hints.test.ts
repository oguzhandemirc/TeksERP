// Bekçi (izlenebilirlik A3): ipucu kataloğunun anahtar kümesi = panel kodları (A2
// `print-error-codes.ts`) ∪ sunucu kodları (A1 `outcomeFromTransport` + `BILINMIYOR`).
// Sunucu kümesi backend KAYNAĞINDAN okunur — yeni kod bir uçta eklenirse kırmızı.
// Sonda: `HEDEF_YOK` ipucu + sunucu aynasından silinince → 1 kırmızı (ölçüldü 2026-10-24).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_ERROR_MESSAGES } from "./print-error-codes";
import { PRINT_ERROR_HINTS, SERVER_PRINT_ERROR_CODES, printErrorHint } from "./print-error-hints";

const BACKEND = resolve(__dirname, "../../../Teks-Erp/src");
const INPUT_HELPER = readFileSync(resolve(BACKEND, "services/helpers/print-job-input.helper.ts"), "utf8");
const SERVICE = readFileSync(resolve(BACKEND, "services/print-job.service.ts"), "utf8");

function backendCodes(): Set<string> {
  const fn = INPUT_HELPER.slice(INPUT_HELPER.indexOf("export function outcomeFromTransport"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  const codes = new Set([...body.matchAll(/code = "([A-Z_]+)"/g)].map((m) => m[1]!));
  // Servis varsayılanı: HATA'da kod yoksa yazılan değer.
  const fallback = /status === "HATA" \? "([A-Z_]+)"/.exec(SERVICE)?.[1];
  if (fallback) codes.add(fallback);
  return codes;
}

describe("basım hata ipucu kataloğu", () => {
  it("zemin: backend kaynağından kod okunabildi", () => {
    expect(backendCodes().size).toBeGreaterThanOrEqual(5);
  });

  it("sunucu aynası = backend kod kümesi", () => {
    expect([...SERVER_PRINT_ERROR_CODES].sort()).toEqual([...backendCodes()].sort());
  });

  it("ipucu anahtarları = panel ∪ sunucu kodları (eksik de fazla da yok)", () => {
    const want = new Set([...Object.keys(PRINT_ERROR_MESSAGES), ...SERVER_PRINT_ERROR_CODES]);
    expect(Object.keys(PRINT_ERROR_HINTS).sort()).toEqual([...want].sort());
  });

  it("her ipucu Türkçe neden + ne yapmalı taşır", () => {
    for (const [code, h] of Object.entries(PRINT_ERROR_HINTS)) {
      expect(h.neden.length, code).toBeGreaterThan(5);
      expect(h.ipucu.length, code).toBeGreaterThan(5);
    }
  });

  it("tanınmayan kod boş kalmaz: sunucu iletisi neden olur", () => {
    expect(printErrorHint("YENI_KOD", "Kağıt bitti").neden).toBe("Kağıt bitti");
    expect(printErrorHint(null, null).neden).toBe("Yazdırılamadı.");
  });
});
