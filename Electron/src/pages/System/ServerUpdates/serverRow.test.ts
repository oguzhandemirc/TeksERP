import { describe, expect, it } from "vitest";
import type { UpdateSummary } from "@/types/server-update";
import { lastUpdateText, serverRowState, UNREADABLE } from "./serverRow";

/**
 * "Sunucu" satırının durumu TEK yerde türetilir (S5, S6). Sıra yük taşır: müdahale isteyen sorun → yürüyen iş →
 * bekleyen sürüm → güncel. Her vaka bir üsttekiyle ÇAKIŞTIRILARAK kurulur ki sıra bozulursa kırmızı versin.
 */
const ozet = (p: Partial<UpdateSummary> = {}): UpdateSummary => ({
  kuruluSurum: "2.12.0",
  donuk: false,
  guncelleyici: { durum: "CALISIYOR" },
  bekleyen: null,
  karar: null,
  yerel: null,
  son: null,
  ...p,
});
const onayBekleyen = { surum: "2.13.0", karar: "ONAY_BEKLIYOR" as const, neden: null, zorunlu: false };
const indiriliyor = { durum: "INDIRILIYOR", hataKodu: null, ilerleme: { indirilen: 25, toplam: 100 } };

describe("serverRowState — öncelik sırası", () => {
  it("DURDU her şeyin önünde: donuk + bekleyen olsa da 'geri alınamadı' + destek", () => {
    const s = serverRowState(ozet({ guncelleyici: { durum: "DURDU" }, donuk: true, bekleyen: onayBekleyen }));
    expect(s.problem).toEqual({ text: expect.stringMatching(/geri alınamadı/), action: "support" });
    expect(s.tone).toBe("danger");
  });

  it("donuk > ölçülemedi: 'Durduruldu' + destek", () => {
    const s = serverRowState(ozet({ donuk: true, guncelleyici: { durum: "OLCULEMEDI" } }));
    expect(s.label).toBe("Durduruldu");
    expect(s.problem?.action).toBe("support");
  });

  it("ölçülemedi > yok: 'yanıt vermiyor' + Yeniden dene", () => {
    const s = serverRowState(ozet({ guncelleyici: { durum: "OLCULEMEDI" }, yerel: indiriliyor }));
    expect(s.problem).toEqual({ text: expect.stringMatching(/yanıt vermiyor/), action: "retry" });
  });

  it("güncelleyici yok → sade not, EYLEMSİZ (kurulum programıyla güncellenir)", () => {
    const s = serverRowState(ozet({ guncelleyici: { durum: "YOK" }, bekleyen: onayBekleyen }));
    expect(s.label).toBe("Güncelleyici yok");
    expect(s.problem?.action).toBeNull();
    expect(s.awaitingApproval).toBe(false);
  });

  it("S5 indiriliyor %N, onay bekleyen sürümün ÖNÜNDE; ilerleme ölçülemiyorsa yüzdesiz", () => {
    expect(serverRowState(ozet({ yerel: indiriliyor, bekleyen: onayBekleyen })).label).toBe("İndiriliyor %25");
    expect(serverRowState(ozet({ yerel: { ...indiriliyor, ilerleme: null } })).label).toBe("İndiriliyor");
  });

  it("S5 kuruluyor: yerel UYGULANIYOR ya da karar KUR — onay bekleyenin önünde", () => {
    expect(serverRowState(ozet({ yerel: { durum: "UYGULANIYOR", hataKodu: null, ilerleme: null }, bekleyen: onayBekleyen })).label).toBe("Kuruluyor");
    expect(serverRowState(ozet({ bekleyen: { ...onayBekleyen, karar: "KUR" } })).label).toBe("Kuruluyor");
  });

  it("onay bekliyor → awaitingApproval; yeni sürüm (pencere) → gerekçeli, onay beklemez", () => {
    const a = serverRowState(ozet({ bekleyen: onayBekleyen }));
    expect(a).toMatchObject({ label: "Onay bekliyor — 2.13.0", awaitingApproval: true, problem: null });
    const p = serverRowState(ozet({ bekleyen: { ...onayBekleyen, karar: "PENCERE_BEKLIYOR" } }));
    expect(p).toMatchObject({ label: "Yeni sürüm 2.13.0", awaitingApproval: false });
    expect(p.hint).toBeTruthy();
  });

  it("planlı kurulum (onay ön duyurusu / pencere anı): 'Kurulum planlandı — sürüm' + an + 5 dk uyarı; onay beklemez, kuruluyor'un ARDINDA", () => {
    const kesinti = { planlanan: "2026-10-12T10:05:00.000Z", kalanSn: 300, suruyor: false };
    const s = serverRowState(ozet({ bekleyen: onayBekleyen, kesinti }));
    expect(s.label).toBe("Kurulum planlandı — 2.13.0");
    expect(s.awaitingApproval).toBe(false);
    expect(s.hint).toMatch(/5 dk önce bütün ekranlarda uyarı çıkar; bağlantı ~1 dk kesilir/);
    expect(serverRowState(ozet({ bekleyen: onayBekleyen, kesinti, yerel: { durum: "UYGULANIYOR", hataKodu: null, ilerleme: null } })).label).toBe("Kuruluyor");
    expect(serverRowState(ozet({ bekleyen: onayBekleyen, kesinti: { ...kesinti, suruyor: true } })).label).toBe("Onay bekliyor — 2.13.0");
  });

  it("aday zaten kurulu sürümse 'yeni sürüm' yok → ✓ Güncel", () => {
    expect(serverRowState(ozet({ bekleyen: { ...onayBekleyen, surum: "2.12.0" } }))).toMatchObject({ label: "✓ Güncel", tone: "success", awaitingApproval: false });
    expect(serverRowState(ozet()).label).toBe("✓ Güncel");
  });

  it("S6 okunamadı sabiti: tek cümle + Yeniden dene", () => {
    expect(UNREADABLE.problem).toEqual({ text: "Sunucunun güncelleme durumu okunamadı.", action: "retry" });
  });
});

describe("lastUpdateText", () => {
  it("yoksa 'henüz yok'; geri dönmüşse ✗", () => {
    expect(lastUpdateText(null)).toBe("Son güncelleme: henüz yok");
    expect(lastUpdateText({ sonuc: "GERI_DONDU", hedefSurum: "2.13.0", bitis: "2026-10-12T00:10:00.000Z" })).toMatch(/Sunucu 2\.13\.0 ✗$/);
  });
});
