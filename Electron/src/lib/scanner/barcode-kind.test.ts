// =============================================================================
// BEKÇİ — BARKOD TÜRÜ TABLODAN ÇÖZÜLÜR (sabit regex beklentisi DEĞİL)
// =============================================================================
// 2026-09-22 (Faz B) öncesinde bu dosya "kod `CV…` ise SACK" gibi SABİT
// beklentiler yazıyordu — yani ön ekin değişmezliğini test ediyordu. Oysa Faz
// B'nin bütün amacı ön ekin DEĞİŞEBİLMESİ. Yeni sözleşme üç cümledir:
//   ① sunucudan gelen tablo neyi söylüyorsa sınıflandırma onu yapar,
//   ② tablo gelmezse YEDEK tablo (bugünkü biçim) devreye girer — okutma yolu
//     fail-closed DEĞİLDİR, çünkü "tablo yok" diye okutmayı kesmek fabrikayı
//     durdurur ve kesin kararı zaten backend 404'ü verir,
//   ③ YEDEK tablo backend kataloğunun aynasıdır ve ayna MEKANİK birebirlenir.
//
// ⭐ NEGATİF SONDA ✓B4 (2026-09-22, ölçüldü): `FALLBACK_SERIES`ten `roll.infix`
//    silinince ❌4 · `loadScanSeries` hatada tabloyu BOŞALTINCA (fail-closed
//    davranış) ❌1 · `classifyBarcode` sunucu tablosu yerine yedeği okuyunca ❌2 ·
//    `resolveBarcodeOnServer` ağ hatasında `ROLL` uydurunca ❌1. Hepsi geri
//    alındı, temiz ağaçta 20/20.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ⚠️ `vi.mock` fabrikası dosyanın TEPESİNE hoist edilir: dışarıdaki bir
// değişkene dokunamaz (`Cannot access 'getMock' before initialization`).
// Bu yüzden mock kendi `vi.fn()`ini kurar, testler onu `vi.mocked` ile alır.
vi.mock("@/services/apiClient", () => ({ default: { get: vi.fn() } }));

import apiClient from "@/services/apiClient";
import {
  FALLBACK_SERIES,
  classifyBarcode,
  loadScanSeries,
  matchesFullFormat,
  resetScanSeries,
  resolveBarcodeOnServer,
  scanSeriesSource,
  scanSeriesTable,
  type ScanSeriesRow,
} from "./barcode-kind";

const getMock = vi.mocked(apiClient.get);

beforeEach(() => {
  getMock.mockReset();
  localStorage.clear();
  resetScanSeries();
});
afterEach(() => {
  resetScanSeries();
});

describe("② YEDEK tablo = bugünkü davranış (tablo hiç gelmese de okutma çalışır)", () => {
  it("bugünkü kodları bugünkü türlerine ayırır", () => {
    expect(scanSeriesSource()).toBe("fallback");
    expect(classifyBarcode("T120726H0001").kind).toBe("ROLL");
    expect(classifyBarcode("T120726F0012").kind).toBe("ROLL");
    expect(classifyBarcode("IE1207260001").kind).toBe("TRAVELER_CARD");
    expect(classifyBarcode("RK1207260001").kind).toBe("TRAVELER_CARD");
    expect(classifyBarcode("KRT1207260042").kind).toBe("SWATCH");
    expect(classifyBarcode("CV1207260001").kind).toBe("SACK");
    expect(classifyBarcode("SVK2109260003").kind).toBe("SHIPMENT");
    for (const c of ["FS1207260123", "FK1207260089", "KS1207260045", "KK1207260089"]) {
      expect(classifyBarcode(c).kind).toBe("DISPATCH_DOC");
    }
  });

  it("uzun ön ek kısa olandan ÖNCE denenir (KRT ↔ K…)", () => {
    expect(classifyBarcode("KRT1207260001").kind).toBe("SWATCH");
    expect(classifyBarcode("KS1207260001").kind).toBe("DISPATCH_DOC");
  });

  it("kodu normalize eder ve serinin anahtarını verir", () => {
    const c = classifyBarcode("  t120726h0001  ");
    expect(c.code).toBe("T120726H0001");
    expect(c.key).toBe("roll");
  });

  it("tanınmayan kod UNKNOWN (tahmin yürütülmez)", () => {
    for (const c of ["RAF-A12", "", "12345", "SIP1207260001", "TEKSTİL BEYAZ"]) {
      expect(classifyBarcode(c).kind).toBe("UNKNOWN");
    }
  });

  it("ağ düşerse YEDEK yerinde kalır — okutma yolu fail-closed DEĞİL", async () => {
    getMock.mockRejectedValueOnce(new Error("ağ yok"));
    const src = await loadScanSeries();
    expect(src).toBe("fallback");
    expect(classifyBarcode("CV1207260001").kind).toBe("SACK");
  });

  it("sunucu bozuk/boş tablo dönerse YEDEK korunur", async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: [] } });
    expect(await loadScanSeries()).toBe("fallback");
    getMock.mockResolvedValueOnce({ data: { success: true, data: [{ key: "x" }] } });
    expect(await loadScanSeries()).toBe("fallback");
    expect(classifyBarcode("CV1207260001").kind).toBe("SACK");
  });
});

describe("① Sunucu tablosu sınıflandırmayı BELİRLER (ön ek değişebilir)", () => {
  const degisikTablo: ScanSeriesRow[] = [
    { key: "sack", kind: "SACK", prefixes: ["ÇV2", "CV"], dateSegment: "DDMMYY", digits: 4, separator: "" },
    { key: "roll", kind: "ROLL", prefixes: ["TP"], dateSegment: "DDMMYY", digits: 5, separator: "-", infix: "[HF]" },
  ];

  it("yeni ön ek tanınır, ESKİ ön ek emekli olarak tanınmaya devam eder", async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: degisikTablo } });
    expect(await loadScanSeries()).toBe("server");
    expect(classifyBarcode("ÇV21207260001").kind).toBe("SACK");
    expect(classifyBarcode("CV1207260001").kind).toBe("SACK"); // emekli ön ek
  });

  it("YEDEK tablodaki ön ek, sunucu tablosunda YOKSA artık tanınmaz", async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: degisikTablo } });
    await loadScanSeries();
    // `KRT` bu tabloda yok → sabit regex olsaydı yine SWATCH derdi; tablo kazanır.
    expect(classifyBarcode("KRT1207260042").kind).toBe("UNKNOWN");
  });

  it("tam-format testi tablodan kurulur (ayraç · hane · infix)", async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: degisikTablo } });
    await loadScanSeries();
    expect(matchesFullFormat("ROLL", "TP-120726-H00001")).toBe(true);
    expect(matchesFullFormat("ROLL", "TP-120726-H0001")).toBe(false); // 5 hane isteniyor
    expect(matchesFullFormat("ROLL", "TP-120726-X00001")).toBe(false); // infix tutmadı
  });

  it("başarılı tablo yerel kopyaya yazılır ve sonraki açılışta kullanılır", async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: degisikTablo } });
    await loadScanSeries();
    const raw = localStorage.getItem("tekserp.scanSeries.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toHaveLength(2);
  });
});

describe("Tam format — hane ESNEK, gevşek çapa ile karıştırılmaz", () => {
  it("bugünkü kodlar tam formattan geçer", () => {
    expect(matchesFullFormat("ROLL", "T120726H0001")).toBe(true);
    expect(matchesFullFormat("TRAVELER_CARD", "RK1207260001")).toBe(true);
    expect(matchesFullFormat("SWATCH", "KRT1207260042")).toBe(true);
    expect(matchesFullFormat("SACK", "CV1207260001")).toBe(true);
    expect(matchesFullFormat("SHIPMENT", "SVK2109260003")).toBe(true);
  });

  it("⭐ 9999'u aşan günde üretilen 5 haneli kod da GEÇER (eski regex reddediyordu)", () => {
    expect(matchesFullFormat("SACK", "CV12072610000")).toBe(true);
    expect(matchesFullFormat("ROLL", "T120726H10000")).toBe(true);
  });

  it("eski/bozuk biçimler geçmez", () => {
    expect(matchesFullFormat("ROLL", "TEKS260709HA001")).toBe(false);
    expect(matchesFullFormat("SACK", "CV-260615-001")).toBe(false);
    expect(matchesFullFormat("TRAVELER_CARD", "RK120726001")).toBe(false); // hane eksik
    expect(matchesFullFormat("ROLL", "T1207260001")).toBe(false); // faz harfi yok
  });

  it("gevşek çapa tanır ama tam format REDDEDER (ikisi ayrı sorudur)", () => {
    expect(classifyBarcode("CV12").kind).toBe("SACK");
    expect(matchesFullFormat("SACK", "CV12")).toBe(false);
  });
});

describe("Sunucuya tek kod sorma — tablo tanımadığında son adım", () => {
  it("sunucunun cevabı kullanılır", async () => {
    getMock.mockResolvedValueOnce({
      data: { data: { code: "ZZ1207260001", kind: "SACK", key: "sack" } },
    });
    expect(await resolveBarcodeOnServer("zz1207260001")).toEqual({
      kind: "SACK",
      code: "ZZ1207260001",
      key: "sack",
    });
  });

  it("ağ düşerse UNKNOWN — TAHMİN YÜRÜTÜLMEZ", async () => {
    getMock.mockRejectedValueOnce(new Error("ağ yok"));
    const r = await resolveBarcodeOnServer("ZZ1207260001");
    expect(r.kind).toBe("UNKNOWN");
    expect(r.key).toBeNull();
  });
});

describe("③ YEDEK tablo ↔ backend kataloğu AYNASI (sessizce bayatlamasın)", () => {
  const BACKEND = readFileSync(
    resolve(__dirname, "../../../../Teks-Erp/src/constants/number-series-catalog.ts"),
    "utf8",
  );

  /** Katalogdaki `kind:` taşıyan satırlardan `key` → { prefix, digits, retired } çıkarır. */
  function backendScannedSeries(): Map<string, { prefix: string; digits: number; retired: string[] }> {
    const out = new Map<string, { prefix: string; digits: number; retired: string[] }>();
    // Katalog girdileri `{ key: "…", … }` bloklarıdır; `kind:` içerenler okutulandır.
    for (const blok of BACKEND.split(/\n\s*\{\s*\n?/).slice(1)) {
      const govde = blok.split(/\n\s*\},?\s*\n/)[0] ?? blok;
      if (!/\bkind:\s*"/.test(govde)) continue;
      const key = /key:\s*"([^"]+)"/.exec(govde)?.[1];
      const prefix = /seedPrefix:\s*"([^"]*)"/.exec(govde)?.[1];
      const digits = /seedDigits:\s*(\d+)/.exec(govde)?.[1];
      if (!key || prefix === undefined || !digits) continue;
      const retiredRaw = /seedRetiredPrefixes:\s*\[([^\]]*)\]/.exec(govde)?.[1] ?? "";
      out.set(key, {
        prefix,
        digits: Number(digits),
        retired: [...retiredRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string),
      });
    }
    return out;
  }

  it("⭐ körlük zemini: ayrıştırıcı backend dosyasını GERÇEKTEN okudu", () => {
    expect(BACKEND.length).toBeGreaterThan(3000);
    expect(backendScannedSeries().size).toBe(FALLBACK_SERIES.length);
  });

  it("⭐ her okutulan serinin ön eki · emeklileri · hanesi birebir aynı", () => {
    const backend = backendScannedSeries();
    for (const row of FALLBACK_SERIES) {
      const b = backend.get(row.key);
      expect(b, `backend kataloğunda yok: ${row.key}`).toBeDefined();
      expect(row.prefixes).toEqual([(b as { prefix: string }).prefix, ...(b as { retired: string[] }).retired]);
      expect(row.digits).toBe((b as { digits: number }).digits);
    }
  });

  it("⭐ top serisinin infix'i aynada da var (faz harfi düşerse okutma kırılır)", () => {
    expect(/infix:\s*\{\s*re:\s*"\[HF\]"/.test(BACKEND)).toBe(true);
    expect(FALLBACK_SERIES.find((r) => r.key === "roll")?.infix).toBe("[HF]");
  });

  it("tablo okuyucusu her zaman bir şey döndürür (boş tabloya düşmez)", () => {
    expect(scanSeriesTable().length).toBeGreaterThan(0);
  });
});
