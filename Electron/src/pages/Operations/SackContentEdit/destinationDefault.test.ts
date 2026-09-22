import { describe, expect, it } from "vitest";
import { resolveDestination, type DestinationLock } from "./destinationDefault";

const lock = (d: DestinationLock["destination"], source: DestinationLock["source"] = d ? "CUSTOMER" : null): DestinationLock => ({
  destination: d,
  source,
  exportCode: null,
  quickShipBlockedReason: null,
});

// 2026-09-13'teki "varsayılan, kilit değil" davranışı 2026-09-23'te KİLİDE çevrildi;
// eski vakalar yeni kuralın karşılığına dönüştürüldü.
describe("resolveDestination — yön cariden/şubeden KİLİTLİ", () => {
  it("cari EXPORT kilitli → EXPORT, seçim gerekmez", () => {
    expect(resolveDestination({ lock: lock("EXPORT"), picked: null })).toEqual({ destination: "EXPORT", locked: true, needsPick: false });
  });
  it("zincir boş, seçim yok → yön YOK ve seçim bekler (örtük DOMESTIC gönderilmez)", () => {
    expect(resolveDestination({ lock: lock(null), picked: null })).toEqual({ destination: null, locked: false, needsPick: true });
  });
  it("⭐ kilitliyken operatörün seçimi YOK SAYILIR (eski 'seçim ezilmez' kuralının tersi)", () => {
    expect(resolveDestination({ lock: lock("EXPORT"), picked: "DOMESTIC" }).destination).toBe("EXPORT");
  });
  it("⭐ zincir boşken ilk seçim kullanılır (karta yazılacak olan)", () => {
    expect(resolveDestination({ lock: lock(null), picked: "EXPORT" })).toEqual({ destination: "EXPORT", locked: false, needsPick: false });
  });
  it("kilit henüz okunmadı → yön yok, seçim de istenmez (yükleniyor)", () => {
    expect(resolveDestination({ lock: undefined, picked: "EXPORT" })).toEqual({ destination: null, locked: false, needsPick: false });
  });
});
