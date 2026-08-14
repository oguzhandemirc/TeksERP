// =============================================================================
// RESMÎ BELGE YAŞAM DÖNGÜSÜ BEKÇİSİ (mutabakat mektubu + çek bordrosu)
// =============================================================================
// Ölçtüğü şeyler:
//  §1 İptal kapısı — iptal edilmiş belge İKİNCİ kez iptal edilemez (backend'in
//     atomik claim 409'unun ekrandaki ikizi; ekran nezaket, sed sunucuda).
//  §2 Onay metni — YIKICI İŞLEM KURALI: etkilenen kayıt SOMUT yazılır ve
//     "kayıt silinmez" gerçeği söylenir (aksi hâlde kullanıcı iptalden kaçınır
//     ve yanlış belge defterde ACTIVE kalır — düzeltilmek istenen tam bu).
//  §3 Kural EKRANDA DEĞİL bu katmanda — iki liste diyaloğu da onu ÇAĞIRIR.
//     Ekran içi bir `if`te yaşasaydı tersine çevrilmesi hiçbir testi kırmazdı.
//
// NEGATİF SONDA (ölçüldü): `officialDocCancelBlockReason` koşulsuz `null`
// döndürüldü → 2 kırmızı (§1a · §1c).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALREADY_CANCELLED_ERROR,
  OFFICIAL_DOC_STATUS_LABEL,
  officialDocCancelBlockReason,
  officialDocCancelSummary,
} from "./officialDocs";

const src = (rel: string): string => readFileSync(resolve(__dirname, rel), "utf8");

describe("§1 iptal kapısı", () => {
  it("§1a iptal edilmiş belge tekrar iptal edilemez", () => {
    expect(officialDocCancelBlockReason({ status: "CANCELLED" })).toBe(ALREADY_CANCELLED_ERROR);
  });

  it("§1b geçerli belge iptal edilebilir", () => {
    expect(officialDocCancelBlockReason({ status: "ACTIVE" })).toBeNull();
  });

  it("§1c sebep DÖNDÜRÜLÜR (boolean değil) — kapalı düğme 'bozuk' okunmasın", () => {
    const reason = officialDocCancelBlockReason({ status: "CANCELLED" });
    expect(typeof reason).toBe("string");
    expect(reason).toContain("iptal");
  });

  it("§1d durum etiketleri TR ve ayırt edici", () => {
    expect(OFFICIAL_DOC_STATUS_LABEL.ACTIVE).not.toBe(OFFICIAL_DOC_STATUS_LABEL.CANCELLED);
    expect(OFFICIAL_DOC_STATUS_LABEL.CANCELLED).toContain("İptal");
  });
});

describe("§2 yıkıcı işlem onay metni", () => {
  it("§2a belge numarası SOMUT olarak yazılır", () => {
    expect(officialDocCancelSummary("BRD1508260001")).toContain("BRD1508260001");
  });

  it("§2b ayrıntı verilirse o da yazılır (hangi kayıt olduğu tek bakışta)", () => {
    const s = officialDocCancelSummary("BRD1508260001", "3 kıymet · 15.08.2026");
    expect(s).toContain("3 kıymet");
  });

  it("§2c 'kayıt SİLİNMEZ' gerçeği söylenir", () => {
    // Bu cümle olmadan kullanıcı "geçmişi sileceğim" korkusuyla iptalden kaçınır
    // ve yanlış belge ACTIVE kalır — düzeltilmek istenen davranışın ta kendisi.
    const s = officialDocCancelSummary("MBT1508260001");
    expect(s).toContain("SİLİNMEZ");
    expect(s).toContain("İPTAL");
  });

  it("§2d geri alınamazlığı ve çıkış yolunu birlikte söyler", () => {
    const s = officialDocCancelSummary("MBT1508260001");
    expect(s).toContain("geri alınamaz");
    expect(s).toContain("yeni bir belge");
  });
});

describe("§3 kural ekranda değil BU katmanda (iki liste de çağırır)", () => {
  it("§3a mutabakat mektubu listesi ortak yüklemi çağırır", () => {
    const list = src("./ReconciliationLetterListDialog.tsx");
    expect(list).toContain("officialDocCancelBlockReason");
    expect(list).toContain("officialDocCancelSummary");
  });

  it("§3b bordro listesi AYNI yüklemi çağırır (ikinci bir yorum yazılmamış)", () => {
    const list = src("./Cheques/ChequeDeliveryNoteListDialog.tsx");
    expect(list).toContain("officialDocCancelBlockReason");
    expect(list).toContain("officialDocCancelSummary");
  });
});
