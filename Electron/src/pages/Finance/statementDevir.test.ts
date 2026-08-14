// =============================================================================
// BEKÇİ — ekstrede aktif devir tespiti (findActiveDevirRowId)
// =============================================================================
// Yüklem iki parçalı (sayım VEYA sıra) ve iki parçanın da KENDİ vakası var —
// biri körleştirilirse hangi testin kırmızı vereceği başlıkta yazılı:
//   • SAYIM parçası (adjCount > cancelCount) → "iptal + GEÇMİŞ tarihli yeniden
//     giriş" vakasını yakalar (yeni devir listede iptalden ÖNCE durur).
//   • SIRA parçası (lastAdjIdx > lastCancelIdx) → pencere eski devri/iptali
//     kesmişken görünen son devrin aktif olduğu vakayı yakalar.
// Negatif sonda 2026-08-14: sayım parçası silindi → "geçmiş tarihli yeniden
// giriş" testi kırmızı; sıra parçası silindi → "pencere iptali kesti" testi
// kırmızı; ikisinde de dosya birebir geri yüklendi.
// =============================================================================

import { describe, expect, it } from "vitest";
import { findActiveDevirRowId } from "./statementDevir";

const row = (id: string, sourceType: string) => ({ id, sourceType });

describe("findActiveDevirRowId", () => {
  it("devir yoksa null (düğme çizilmez)", () => {
    expect(findActiveDevirRowId([row("a", "INVOICE"), row("b", "PAYMENT")])).toBeNull();
  });

  it("tek aktif devir → o satır", () => {
    expect(findActiveDevirRowId([row("d1", "ADJUSTMENT"), row("f1", "INVOICE")])).toBe("d1");
  });

  it("devir + iptali birlikte görünüyor, yeni devir YOK → null (terslenmiş devirde düğme çıkmaz)", () => {
    expect(findActiveDevirRowId([row("d1", "ADJUSTMENT"), row("c1", "ADJUSTMENT_CANCEL")])).toBeNull();
  });

  it("iptalden SONRA yeniden girilen devir → yeni satır", () => {
    expect(
      findActiveDevirRowId([
        row("d1", "ADJUSTMENT"),
        row("c1", "ADJUSTMENT_CANCEL"),
        row("d2", "ADJUSTMENT"),
      ]),
    ).toBe("d2");
  });

  it("SAYIM vakası: iptal + GEÇMİŞ tarihli yeniden giriş (yeni devir listede iptalden ÖNCE) → yine bulunur", () => {
    // Ekstre tarihe göre sıralı: d2 geçmiş tarihle girildiği için c1'den önce
    // durur. Sıra parçası tek başına (lastAdj=d2 < lastCancel=c1) null derdi;
    // sayım parçası (2 devir > 1 iptal) aktif devri yakalar. Düğme SON
    // ADJUSTMENT satırına bağlanır — backend zaten aktif olanı kendisi bulur.
    expect(
      findActiveDevirRowId([
        row("d1", "ADJUSTMENT"),
        row("d2", "ADJUSTMENT"),
        row("c1", "ADJUSTMENT_CANCEL"),
      ]),
    ).toBe("d2");
  });

  it("SIRA vakası: pencere eski devri kesmiş, görünürde iptal + sonra yeni devir → yeni satır", () => {
    // Eski devir (d1) pencere DIŞINDA: görünen sayım 1 devir / 1 iptal (eşit),
    // sayım parçası tek başına null derdi; sıra parçası (son devir iptalden
    // sonra) aktif devri yakalar.
    expect(findActiveDevirRowId([row("c1", "ADJUSTMENT_CANCEL"), row("d2", "ADJUSTMENT")])).toBe("d2");
  });

  it("pencere yalnız İPTALİ gösteriyor (devir dışarıda) → null — düğme uydurulmaz", () => {
    expect(findActiveDevirRowId([row("c1", "ADJUSTMENT_CANCEL"), row("f1", "INVOICE")])).toBeNull();
  });

  it("girdi boşsa null", () => {
    expect(findActiveDevirRowId([])).toBeNull();
  });
});

// ── KESİN YOL (I3, 2026-08-14) — satırlar reversedByTxnId taşıyorsa ─────────
// Yukarıdaki testlerin TAMAMI alan taşımayan fixture kullanır → sezgisel
// fallback'i ölçmeye DEVAM EDERLER (eski backend paritesi bedavaya kilitli).
describe("findActiveDevirRowId — kesin yol (reversedByTxnId)", () => {
  const linked = (id: string, sourceType: string, reversedByTxnId: string | null) => ({
    id,
    sourceType,
    reversedByTxnId,
  });

  it("terslenmiş devir → null (düğme çizilmez), sayım/sıra yüklemine BAKILMAZ", () => {
    // Sezgisel yol bu pencerede (yalnız devir görünür, iptal satırı pencere
    // DIŞINDA) yanlış-pozitif verirdi; kesin yol satırın kendi bilgisinden bilir.
    expect(findActiveDevirRowId([linked("d1", "ADJUSTMENT", "c1")])).toBeNull();
  });

  it("terslenmemiş devir → id", () => {
    expect(findActiveDevirRowId([linked("d1", "ADJUSTMENT", null)])).toBe("d1");
  });

  it("iptal + yeniden giriş zinciri: yalnız AKTİF (terslenmemiş) devir seçilir", () => {
    expect(
      findActiveDevirRowId([
        linked("d1", "ADJUSTMENT", "c1"),
        linked("c1", "ADJUSTMENT_CANCEL", null),
        linked("d2", "ADJUSTMENT", null),
      ]),
    ).toBe("d2");
  });

  it("geçmiş tarihli yeniden giriş (yeni devir listede iptalden ÖNCE) → yine doğru satır", () => {
    // Sezgiselin SAYIM parçasına ihtiyaç duyduğu vaka — kesin yolda trivially doğru.
    expect(
      findActiveDevirRowId([
        linked("d2", "ADJUSTMENT", null),
        linked("d1", "ADJUSTMENT", "c1"),
        linked("c1", "ADJUSTMENT_CANCEL", null),
      ]),
    ).toBe("d2");
  });

  it("alan gelmiyorsa (eski backend) SEZGİSEL fallback çalışır — terslenmiş-görünmeyen devir bulunur", () => {
    // Aynı pencere kesin yolda null verirdi; alan yokken sezgisel devreye girer
    // ve yanlış-pozitif SESLİ düşer (backend 404) — bilinçli fallback sözleşmesi.
    expect(findActiveDevirRowId([{ id: "d1", sourceType: "ADJUSTMENT" }])).toBe("d1");
  });
});
