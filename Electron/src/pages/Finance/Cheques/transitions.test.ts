// =============================================================================
// ÇEK DURUM MAKİNESİ AYNASI — BEKÇİ
// =============================================================================
// `transitions.ts` backend `loadForTransition` listelerinin BİREBİR kopyasıdır
// (dosya başlığındaki sözleşme). Bu test aynanın en kolay kaybedilen iki
// özelliğini kilitler:
//
// 1) K-2 TAHSİL STORNOSU: COLLECTED artık tam terminal DEĞİL — tek çıkışı
//    "Tahsili Geri Al"dır ve YALNIZ odur. Satır silinirse COLLECTED çekte menü
//    hiç çizilmez ve yanlış tahsil kaydı ekrandan ÇIKMAZ hale gelir (hata yok,
//    log yok — backend ucu var ama kapısı yok). Fazla eklenirse kullanıcı
//    kesin 409'a gönderilir.
//
// 2) KAPAMA ENGELİ STORNOYA UYGULANMAZ: backend `cancelCollect` kapamalara
//    bilinçli dokunmaz ("tahsil stornosu çekin varlığını yok etmez"). Panel
//    `blockedByAllocation: true` yaparsa, kapamalı çekin MEŞRU stornosu ekranda
//    sahte bir engel bandıyla kapanır — backend kabul edecekken.
//
// 3) STORNO AİLESİ: CANCELLED dışındaki her terminal (ve ENDORSED) kendi tipli
//    stornosunu menüde gösterir; storno tanımı yalnız sebep sorar.
//
// Negatif sonda (2026-08-14, boz-ölç-geri yükle TEK komut zincirinde koşuldu):
// `collect-cancel` girdisi geçici SİLİNDİ → 3 test kırmızı; `from` listesi
// PORTFOLIO'ya çevrildi → 3 test kırmızı. İki sondada da dosya shasum ile
// birebir geri yüklendi (ca486fc0). Storno ailesi (2026-09-11, md5 ile geri
// alındı): `bounce-cancel` silindi → 2 · pay-cancel kapama engeli → 1 ·
// endorse-cancel yön kapısı kaldırıldı → 1 test kırmızı.
// =============================================================================
import { describe, expect, it } from "vitest";
import { CHEQUE_ACTIONS, allocationBlockReason, availableActions } from "./transitions";
import type { ChequeStatus } from "./service";

/**
 * Backend storno uçlarının `loadForTransition` aynası: eylem → [kaynak durum, yön].
 * Terminallerin CANCELLED dışındaki her biri TEK çıkışını buradan alır.
 */
const REVERSALS: ReadonlyArray<{ action: string; from: ChequeStatus; kind: "RECEIVED" | "ISSUED" | null; reverses: string }> = [
  { action: "collect-cancel", from: "COLLECTED", kind: "RECEIVED", reverses: "COLLECT" },
  { action: "endorse-cancel", from: "ENDORSED", kind: "RECEIVED", reverses: "ENDORSE" },
  { action: "bounce-cancel", from: "BOUNCED", kind: "RECEIVED", reverses: "BOUNCE" },
  { action: "return-cancel", from: "RETURNED", kind: null, reverses: "RETURN" },
  { action: "pay-cancel", from: "PAID", kind: "ISSUED", reverses: "PAY" },
];

describe("çek durum makinesi aynası (transitions.ts)", () => {
  it("COLLECTED (alınan) çekte TEK işlem vardır: Tahsili Geri Al", () => {
    const actions = availableActions({ kind: "RECEIVED", status: "COLLECTED" });
    expect(actions.map((a) => a.action)).toEqual(["collect-cancel"]);
  });

  it("collect-cancel tanımı backend sözleşmesinin aynasıdır", () => {
    const def = CHEQUE_ACTIONS.find((a) => a.action === "collect-cancel");
    expect(def).toBeDefined();
    // Uç yalnız `reason` kabul eder (`.strict()`, sebep zorunlu) → diyalog
    // sebep dalını çizmeli, tarih/hesap SORMAMALI.
    expect(def?.needs).toBe("reason");
    // Para hareketi geri alınıyor → yıkıcı onay (kırmızı düğme + somut metin).
    expect(def?.destructive).toBe(true);
    // Backend `cancelCollect` RECEIVED-only (`loadForTransition` kind guard'ı).
    expect(def?.kind).toBe("RECEIVED");
    expect(def?.from).toEqual(["COLLECTED"]);
  });

  it("verdiğimiz (ISSUED yönlü) çekte tahsil stornosu ÇIKMAZ", () => {
    // PAID bizim çekimizin terminalidir; COLLECTED durumuna ISSUED çek zaten
    // düşmez ama ayna yine de kind guard'ını taşımalı (backend 400 verirdi).
    expect(availableActions({ kind: "ISSUED", status: "COLLECTED" })).toEqual([]);
  });

  it("İPTAL tek menüsüz terminaldir (stornonun tersi yok)", () => {
    expect(availableActions({ kind: "RECEIVED", status: "CANCELLED" })).toEqual([]);
    expect(availableActions({ kind: "ISSUED", status: "CANCELLED" })).toEqual([]);
  });

  it("her storno tanımı backend sözleşmesinin aynasıdır (sebep · yıkıcı · kapama engeli yok)", () => {
    for (const r of REVERSALS) {
      const def = CHEQUE_ACTIONS.find((a) => a.action === r.action);
      expect(def, r.action).toBeDefined();
      expect(def?.from).toEqual([r.from]);
      expect(def?.kind).toBe(r.kind);
      expect(def?.needs).toBe("reason");
      expect(def?.destructive).toBe(true);
      expect(def?.blockedByAllocation).toBe(false);
      expect(def?.reverses).toBe(r.reverses);
    }
    // Storno olmayan tanım `reverses` taşımaz — diyalog onu storno sanıp sebep sorardı.
    const reversalActions = new Set(REVERSALS.map((r) => r.action));
    expect(CHEQUE_ACTIONS.filter((a) => a.reverses !== undefined).every((a) => reversalActions.has(a.action))).toBe(true);
  });

  it("terminal çekte menüde YALNIZ kendi stornosu çıkar, yön kapısıyla", () => {
    expect(availableActions({ kind: "RECEIVED", status: "BOUNCED" }).map((a) => a.action)).toEqual(["bounce-cancel"]);
    expect(availableActions({ kind: "ISSUED", status: "BOUNCED" })).toEqual([]);
    expect(availableActions({ kind: "RECEIVED", status: "RETURNED" }).map((a) => a.action)).toEqual(["return-cancel"]);
    expect(availableActions({ kind: "ISSUED", status: "RETURNED" }).map((a) => a.action)).toEqual(["return-cancel"]);
    expect(availableActions({ kind: "ISSUED", status: "PAID" }).map((a) => a.action)).toEqual(["pay-cancel"]);
    expect(availableActions({ kind: "RECEIVED", status: "PAID" })).toEqual([]);
  });

  it("ciro edilmiş çekte karşılıksız + ciro stornosu var, iade/iptal YOK", () => {
    const actions = availableActions({ kind: "RECEIVED", status: "ENDORSED" }).map((a) => a.action);
    expect(actions.sort()).toEqual(["bounce", "endorse-cancel"]);
  });

  it("canlı durumlara tahsil/karşılıksız/iade/ödeme stornosu SIZMAZ (fazla göstermek = kesin 409)", () => {
    for (const status of ["PORTFOLIO", "AT_BANK", "ENDORSED", "ISSUED"] as const) {
      for (const kind of ["RECEIVED", "ISSUED"] as const) {
        const actions = availableActions({ kind, status }).map((a) => a.action);
        for (const leaked of ["collect-cancel", "bounce-cancel", "return-cancel", "pay-cancel"]) {
          expect(actions).not.toContain(leaked);
        }
      }
    }
  });

  it("kapama engeli STORNOYA uygulanmaz, iptale uygulanır (backend paritesi)", () => {
    const row = { allocatedTotal: "1500.00", currency: "TRY" };
    const collectCancel = CHEQUE_ACTIONS.find((a) => a.action === "collect-cancel")!;
    const cancel = CHEQUE_ACTIONS.find((a) => a.action === "cancel")!;
    // Backend `cancelCollect` kapamalara DOKUNMAZ → panel engel basmamalı.
    expect(allocationBlockReason(row, collectCancel)).toBeNull();
    // `cancel` ise `requireUnallocated` taşır → panel engeli söylemeli.
    expect(allocationBlockReason(row, cancel)).toContain("kapatılmış");
  });
});
