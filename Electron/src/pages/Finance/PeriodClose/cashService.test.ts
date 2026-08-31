// =============================================================================
// BEKÇİ — kasa/banka dönem kapanışı istemcisinin saf katmanı
// =============================================================================
// Üç kural kilitlenir; üçü de ekranda sessizce bozulabilen türden:
//
//   1. HESAP XOR (`cashAccountParams`): iki anahtar birden gönderilirse backend
//      400 verir ve KULLANICI hiçbir liste/önizleme alamaz. Tek kaynak bu
//      fonksiyondur — bozulursa her uç birden bozulur.
//   2. HESAP KİMLİĞİ TÜR TAŞIR (`cashAccountKey`): kasa ile banka ayrı
//      tablolardır, aynı uuid iki tabloda bulunabilir; tür anahtardan düşerse
//      iki hesabın kapanışları tek hesaba karışır ve LIFO yüzeyi yanlış satıra
//      "en son" der.
//   3. LIFO YÜZEYİ (`latestActiveCloseIds`): "Yeniden Aç" yalnız hesabın EN SON
//      AKTİF kapanışında etkin. Yeniden açılmış satır sayılırsa buton ya
//      açılmış satıra düşer ya gerçek en-son aktif satırdan kaçar — backend 409
//      son sed olarak durur ama ekran "bastım, olmadı"ya döner.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  cashAccountKey,
  cashAccountParams,
  fmtCashMoney,
  latestActiveCloseIds,
} from "./cashService";

const ROW = (
  id: string,
  accountKind: "CASH_BOX" | "BANK_ACCOUNT",
  accountId: string,
  periodEnd: string,
  reopenedAt: string | null = null,
) => ({ id, accountKind, accountId, periodEnd, reopenedAt });

describe("cashAccountParams — hesap XOR", () => {
  it("kasa: yalnız cashBoxId anahtarı taşır", () => {
    const p = cashAccountParams("CASH_BOX", "id-1");
    expect(p.cashBoxId).toBe("id-1");
    // Anahtarın YOKLUĞU da sözleşmedir: `bankAccountId: undefined` bile olsa
    // axios onu atar ama elle JSON.stringify eden bir yol iki anahtar basar.
    expect("bankAccountId" in p).toBe(false);
  });

  it("banka: yalnız bankAccountId anahtarı taşır", () => {
    const p = cashAccountParams("BANK_ACCOUNT", "id-2");
    expect(p.bankAccountId).toBe("id-2");
    expect("cashBoxId" in p).toBe(false);
  });
});

describe("cashAccountKey — tür kimliğin parçası", () => {
  it("aynı uuid, farklı tür → FARKLI anahtar", () => {
    expect(cashAccountKey("CASH_BOX", "ayni-uuid")).not.toBe(cashAccountKey("BANK_ACCOUNT", "ayni-uuid"));
  });
});

describe("latestActiveCloseIds — LIFO yüzeyi", () => {
  it("hesap başına yalnız EN YENİ aktif kapanışı seçer", () => {
    const rows = [
      ROW("ocak", "CASH_BOX", "kasa-1", "2026-01-31T00:00:00.000Z"),
      ROW("subat", "CASH_BOX", "kasa-1", "2026-02-28T00:00:00.000Z"),
      ROW("aralik", "CASH_BOX", "kasa-1", "2025-12-31T00:00:00.000Z"),
    ];
    expect(latestActiveCloseIds(rows)).toEqual(new Set(["subat"]));
  });

  it("en yeni kapanış REOPEN edilmişse 'en son aktif' ondan öncekidir", () => {
    // Saha senaryosu: Ocak kapandı, Şubat kapandı, Şubat yeniden açıldı.
    // Yeniden Aç düğmesi artık OCAK'ta olmalı — Şubat satırında değil.
    const rows = [
      ROW("ocak", "CASH_BOX", "kasa-1", "2026-01-31T00:00:00.000Z"),
      ROW("subat", "CASH_BOX", "kasa-1", "2026-02-28T00:00:00.000Z", "2026-03-05T10:00:00.000Z"),
    ];
    expect(latestActiveCloseIds(rows)).toEqual(new Set(["ocak"]));
  });

  it("hesaplar birbirine karışmaz — tür dahil (aynı uuid'li kasa/banka)", () => {
    const rows = [
      ROW("kasa-ocak", "CASH_BOX", "ayni-uuid", "2026-01-31T00:00:00.000Z"),
      ROW("banka-aralik", "BANK_ACCOUNT", "ayni-uuid", "2025-12-31T00:00:00.000Z"),
    ];
    // Tür anahtardan düşerse iki hesap tek kovaya iner ve banka-aralik
    // (daha eski) elenir — banka hesabının "Yeniden Aç" düğmesi kaybolur.
    expect(latestActiveCloseIds(rows)).toEqual(new Set(["kasa-ocak", "banka-aralik"]));
  });

  it("girdi sırasından bağımsızdır", () => {
    const a = ROW("eski", "CASH_BOX", "k", "2026-01-31T00:00:00.000Z");
    const b = ROW("yeni", "CASH_BOX", "k", "2026-02-28T00:00:00.000Z");
    expect(latestActiveCloseIds([a, b])).toEqual(new Set(["yeni"]));
    expect(latestActiveCloseIds([b, a])).toEqual(new Set(["yeni"]));
  });

  it("tamamı yeniden açılmış hesap için HİÇ satır dönmez", () => {
    const rows = [ROW("x", "CASH_BOX", "k", "2026-01-31T00:00:00.000Z", "2026-02-01T00:00:00.000Z")];
    expect(latestActiveCloseIds(rows).size).toBe(0);
  });
});

describe("fmtCashMoney — para birimi bilinmiyorsa sembolsüz ama DOĞRU", () => {
  it("birim biliniyorsa sembollü basar", () => {
    expect(fmtCashMoney("15000", "TRY")).toContain("₺");
    expect(fmtCashMoney(15000, "TRY")).toContain("15.000,00");
  });

  it("birim bilinmiyorsa sayı SEMBOLSÜZ basılır — '—' DEĞİL (değer elde)", () => {
    const s = fmtCashMoney("1234.5", null);
    expect(s).toBe("1.234,50");
  });

  it("değer yoksa/bozuksa '—' basar (0,00 değil — sıfır bir TUTARDIR)", () => {
    expect(fmtCashMoney(null, "TRY")).toBe("—");
    expect(fmtCashMoney(undefined, null)).toBe("—");
    expect(fmtCashMoney("abc", null)).toBe("—");
  });
});
