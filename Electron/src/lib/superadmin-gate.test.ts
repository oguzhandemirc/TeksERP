// =============================================================================
// BEKÇİ — SATICI KAPISI TEK KAYNAK
// =============================================================================
// ⚠️ 2026-09-04: yüklem TEKE indi. Eskiden ikinci bir supapsız yüklem vardı
// (`isSystemAccountIdentity`, GÖRÜNÜRLÜK için) ve meşruydu — modül anahtarları
// Genel Ayarlar'dan da yazılabiliyordu. O sekme kaldırılınca supapsız kural bir
// kilitlenme kaynağı hâline geldi; gerekçe `superadmin-gate.ts` başlığında.
//
// ⭐ ASIL RİSK DAVRANIŞ DEĞİL, KOPYADIR. Yüklem beş yerde (Sistem hub karosu ·
// `FeatureFlagSection` · Modüller sayfası · komut paleti · route kapısı) ayrı ayrı
// yazılsaydı EMNİYET SUPABI (`!systemAccountExists`) birinde unutulurdu ve
// unutulduğu yerin bedeli şudur: sistem hesabı hiç doğmamış bir kurulumda modül
// anahtarları BİR DAHA açılamaz. Bu yüzden test iki şeyi birden ölçer:
//   ① yüklemin doğruluk tablosu,
//   ② tüketicilerin bu dosyadan İTHAL ettiği (kaynak metni taranır — davranışı
//      ikizlemek yetmez, kaynağın TEK olması gerekir).
//
// NEGATİF SONDA (2026-09-03, md5 ile geri alındı):
//   ① `|| !state.systemAccountExists` düşürüldü → §1 kırmızı (1).
//   ② `SystemHubPage` içinde yüklem elle yazıldı (import kaldırıldı) →
//      §2 kırmızı (1).
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSuperadminGateOpen } from "./superadmin-gate";

const TUKETICILER = [
  "../pages/GeneralSettings/FeatureFlagSection.tsx",
  "../pages/System/SystemHubPage.tsx",
  "../pages/System/ModuleProfile/ModuleProfilePage.tsx",
  "../components/layout/CommandPalette.tsx",
  // 2026-09-04: satıcı ekranının ROUTE kapısı da bu yüklemi kullanıyor. Liste
  // dışında kalması ölçüldü (negatif sonda: route supapsız bir kurala
  // çevrildiğinde §2 yeşil kaldı, kırmızıyı yalnız ekran bekçisi verdi).
  "../components/ProtectedRoute.tsx",
] as const;

describe("§1 doğruluk tablosu", () => {
  it("satıcı hesabı → AÇIK", () => {
    expect(isSuperadminGateOpen({ isSystemAccount: true, systemAccountExists: true })).toBe(true);
  });

  it("fabrika yöneticisi + sistem hesabı VAR → KAPALI", () => {
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: true })).toBe(false);
  });

  it("⭐ SUPAP: sistem hesabı HİÇ doğmamışsa → AÇIK", () => {
    // Bu satır olmadan süperadminsiz her kurulum modüllerini bir daha
    // yapılandıramaz; backend `flagWriteGuard`ın üçüncü dalıyla AYNI kaynak.
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: false })).toBe(true);
  });

  it("satıcı hesabı + hesap yok → AÇIK (iki dal da doğru)", () => {
    expect(isSuperadminGateOpen({ isSystemAccount: true, systemAccountExists: false })).toBe(true);
  });
});

describe("§2 tüketiciler AYNI kaynaktan okuyor", () => {
  it("körlük zemini: tüketici dosyaları okunabildi", () => {
    for (const rel of TUKETICILER) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src.length, rel).toBeGreaterThan(500);
    }
  });

  it("⭐ hepsi `isSuperadminGateOpen`i İTHAL ediyor", () => {
    for (const rel of TUKETICILER) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src, `${rel} yüklemi tek kaynaktan almıyor`).toContain(
        'from "@/lib/superadmin-gate"',
      );
    }
  });

  it("⭐ hiçbir tüketici kuralı ELLE yazmıyor (kopya = ayrışma)", () => {
    // Kopya deseninin metinsel imzası: iki alanın `||` ile birleştirilmesi.
    const kopya = /isSystemAccount\s*\|\|\s*!\s*systemAccountExists/;
    for (const rel of TUKETICILER) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(kopya.test(src), `${rel} kuralı elle yazmış`).toBe(false);
    }
  });
});
