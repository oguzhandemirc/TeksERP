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
// Negatif sonda (2026-08-14, boz-ölç-geri yükle TEK komut zincirinde koşuldu):
// `collect-cancel` girdisi geçici SİLİNDİ → 3 test kırmızı; `from` listesi
// PORTFOLIO'ya çevrildi → 3 test kırmızı. İki sondada da dosya shasum ile
// birebir geri yüklendi (ca486fc0).
// =============================================================================
import { describe, expect, it } from "vitest";
import { CHEQUE_ACTIONS, allocationBlockReason, availableActions } from "./transitions";
import type { ChequeStatus } from "./service";

/** Backend TERMINAL_STATUSES aynası — COLLECTED'ın K-2 istisnası testte açık. */
const HARD_TERMINALS: readonly ChequeStatus[] = ["BOUNCED", "RETURNED", "PAID", "CANCELLED"];

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

  it("gerçek terminaller (BOUNCED/RETURNED/PAID/CANCELLED) menüsüz kalır", () => {
    for (const status of HARD_TERMINALS) {
      expect(availableActions({ kind: "RECEIVED", status })).toEqual([]);
      expect(availableActions({ kind: "ISSUED", status })).toEqual([]);
    }
  });

  it("canlı durumlara collect-cancel SIZMAZ (fazla göstermek = kesin 409)", () => {
    for (const status of ["PORTFOLIO", "AT_BANK", "ENDORSED", "ISSUED"] as const) {
      const actions = availableActions({ kind: "RECEIVED", status }).map((a) => a.action);
      expect(actions).not.toContain("collect-cancel");
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
