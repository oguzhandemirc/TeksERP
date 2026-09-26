// =============================================================================
// TESLİM BORDROSU HAREKET FİŞİ (K3) — panel bekçisi
// =============================================================================
// Ölçtüğü şeyler:
//  §1 Hareket yalnız bayrak açık + aldığımız çeklerde sorulur (verdiğimiz çekin teslimi hareket değil).
//  §2 Teslim türü kapısı ve gövde: YALNIZ seçilen türün kimliği gider; "yalnız belge"de hiçbiri.
//  §3 ⭐ FAIL-CLOSED gövde: eksik teslim türü SESSİZCE belge-only gövdeye düşmez (fırlatır);
//     bayrak kapalıyken gövde bugünküyle AYNI (hedef anahtarı hiç yok).
//  §4 409 çözümü `code` ile (DELIVERY_ROWS_BLOCKED · DELIVERY_ITEMS_ADVANCED); başka hata `null`.
//  §5 İptal seçimi: yalnız canlı + geri alınabilir kalem seçilir; sebep zorunlu; hepsi seçilince
//     bordro da kapanır ve ekran bunu SÖYLER.
//  §6 EKRAN DİKİŞİ: diyalog teslim türünü + planı bağlar, liste iptal panelini mount eder, panel
//     önizleme ucunu çağırır ve seçimi yalnız hareketli bordroda gönderir.
//
// NEGATİF SONDA (2026-09-26, `cp` + md5 ile geri yüklendi):
//   ① `targetBodyFields` iki kimliği birden gönderdi → §2c ❌
//   ② `buildDraftBody` eksik hedefte fırlatmadı → §3a ❌
//   ③ liste `<DeliveryNoteCancelPanel` mount'u kaldırıldı → §6b ❌
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDraftBody, deliveryNoteBlockReason, type DeliveryNoteDraft } from "./chequeDeliveryNote";
import {
  BANK_REQUIRED,
  CANCEL_REASON_REQUIRED,
  CANCEL_SELECTION_REQUIRED,
  CARI_REQUIRED,
  TARGET_KIND_REQUIRED,
  cancelSelectionBlockReason,
  cancelWillCloseNote,
  movementApplies,
  planBlockReason,
  reversibleIds,
  rowIssuesError,
  targetBlockReason,
  targetBodyFields,
  type CancelPreviewItem,
} from "./chequeNoteMovement";
import type { ChequeRow } from "./service";

const src = (rel: string): string => readFileSync(resolve(__dirname, rel), "utf8");
const row = (id: string): ChequeRow => ({ id, kind: "RECEIVED", status: "PORTFOLIO", currency: "TRY" }) as ChequeRow;
const base: DeliveryNoteDraft = { rows: [row("a"), row("b")], dateYmd: "2026-09-26", targetLabel: "", notes: "" };
const axiosErr = (data: unknown) => ({ response: { data } });

describe("§1 hareket nerede sorulur", () => {
  it("§1a bayrak kapalı → hiç", () => expect(movementApplies(false, "RECEIVED")).toBe(false));
  it("§1b verdiğimiz çek → hiç (verme doğuşta yazıldı)", () => expect(movementApplies(true, "ISSUED")).toBe(false));
  it("§1c bayrak açık + aldığımız çek → sorulur", () => expect(movementApplies(true, "RECEIVED")).toBe(true));
});

describe("§2 teslim türü kapısı ve gövdesi", () => {
  it("§2a tür seçilmedi / banka yok / cari yok → her biri kendi sebebi", () => {
    expect(targetBlockReason({ targetKind: null, bankAccountId: null, cariId: null })).toBe(TARGET_KIND_REQUIRED);
    expect(targetBlockReason({ targetKind: "BANK", bankAccountId: null, cariId: null })).toBe(BANK_REQUIRED);
    expect(targetBlockReason({ targetKind: "CARI", bankAccountId: null, cariId: null })).toBe(CARI_REQUIRED);
    expect(targetBlockReason({ targetKind: "TEXT", bankAccountId: null, cariId: null })).toBeNull();
  });
  it("§2b yalnız belge → hedef kimliği GİTMEZ", () =>
    expect(targetBodyFields({ targetKind: "TEXT", bankAccountId: "x", cariId: "y" })).toEqual({}));
  it("§2c ⭐ yalnız seçilen türün kimliği gider (backend çift hedefi 400'ler)", () => {
    expect(targetBodyFields({ targetKind: "BANK", bankAccountId: "bank", cariId: "cari" })).toEqual({ bankAccountId: "bank" });
    expect(targetBodyFields({ targetKind: "CARI", bankAccountId: "bank", cariId: "cari" })).toEqual({ cariId: "cari" });
  });
});

describe("§3 fail-closed gövde", () => {
  it("§3a ⭐ eksik teslim türü belge-only gövdeye DÜŞMEZ, fırlatır", () => {
    const d = { ...base, target: { targetKind: "BANK" as const, bankAccountId: null, cariId: null } };
    expect(deliveryNoteBlockReason(d)).toBe(BANK_REQUIRED);
    expect(() => buildDraftBody(d)).toThrow(BANK_REQUIRED);
  });
  it("§3b bankaya → gövdede bankAccountId", () => {
    const body = buildDraftBody({ ...base, target: { targetKind: "BANK", bankAccountId: "bank", cariId: null } });
    expect(body.bankAccountId).toBe("bank");
    expect("cariId" in body).toBe(false);
  });
  it("§3c ⭐ bayrak kapalı (target yok) → gövde bugünkü: hedef anahtarı hiç yok", () => {
    const body = buildDraftBody(base);
    expect(Object.keys(body).sort()).toEqual(["chequeIds", "deliveryDate"]);
  });
});

describe("§4 409 çözümü", () => {
  it("§4a kaydın satır reddi listelenir", () => {
    const r = rowIssuesError(axiosErr({ message: "m", details: { code: "DELIVERY_ROWS_BLOCKED", rows: [{ chequeId: "a", docNo: "C1", reason: "bankada" }] } }));
    expect(r?.rows).toEqual([{ chequeId: "a", docNo: "C1", reason: "bankada" }]);
  });
  it("§4b iptalin ilerlemiş kalemleri listelenir", () => {
    const r = rowIssuesError(axiosErr({ details: { code: "DELIVERY_ITEMS_ADVANCED", items: [{ chequeId: "a", docNo: "C1", reason: "tahsil" }] } }));
    expect(r?.code).toBe("DELIVERY_ITEMS_ADVANCED");
    expect(r?.rows).toHaveLength(1);
  });
  it("§4c başka hata ve bozuk gövde → null (gerçek hata listeye karışmaz)", () => {
    expect(rowIssuesError(axiosErr({ details: { code: "ALREADY_IN_ACTIVE_NOTE" } }))).toBeNull();
    expect(rowIssuesError(new Error("ağ"))).toBeNull();
    expect(rowIssuesError(null)).toBeNull();
  });
  it("§4d plan engelli satır taşıyorsa Kaydet sebebi", () => {
    expect(planBlockReason(undefined)).toBeNull();
    expect(planBlockReason({ type: "DEPOSIT", rows: [{ chequeId: "a", docNo: "C1", action: "DEPOSIT", fromStatus: "AT_BANK", toStatus: "AT_BANK", blockedReason: "x" }] })).toMatch(/1 kıymet/);
  });
});

describe("§5 iptal seçimi", () => {
  const item = (id: string, o: Partial<CancelPreviewItem>): CancelPreviewItem => ({
    chequeId: id, docNo: id, amount: "1", currency: "TRY", status: "AT_BANK", action: "DEPOSIT", reversed: false, reversible: true, reason: null, ...o,
  });
  const items = [item("a", {}), item("b", { reversible: false, reason: "tahsil" }), item("c", { reversed: true })];
  it("§5a yalnız canlı + geri alınabilir seçilir", () => expect(reversibleIds(items)).toEqual(["a"]));
  it("§5b seçim ve sebep zorunlu", () => {
    expect(cancelSelectionBlockReason(new Set(), "x")).toBe(CANCEL_SELECTION_REQUIRED);
    expect(cancelSelectionBlockReason(new Set(["a"]), "  ")).toBe(CANCEL_REASON_REQUIRED);
    expect(cancelSelectionBlockReason(new Set(["a"]), "yanlış")).toBeNull();
  });
  it("§5c bütün canlı kalemler seçilince bordro da kapanır (geri alınamayan canlıdır, kapanmaz)", () => {
    expect(cancelWillCloseNote(items, new Set(["a"]))).toBe(false);
    expect(cancelWillCloseNote([items[0]!, items[2]!], new Set(["a"]))).toBe(true);
  });
});

describe("§6 ekran dikişi", () => {
  it("§6a diyalog bayrağı okur, teslim türünü ve planı bağlar, izni ekranda da sorar", () => {
    const d = src("./ChequeBordroDialog.tsx");
    expect(d).toContain("financeChequeNoteMovementEnabled");
    expect(d).toContain("movementApplies(");
    expect(d).toContain("<BordroTargetFields");
    expect(d).toContain("<BordroMovementPlan");
    expect(d).toContain('hasPermission("finance:cheque")');
  });
  it("§6b ⭐ liste iptal panelini MOUNT eder", () => {
    expect(src("./ChequeDeliveryNoteListDialog.tsx")).toContain("<DeliveryNoteCancelPanel");
  });
  it("§6c panel önizleme ucunu çağırır, seçimi YALNIZ hareketli bordroda gönderir, hareketi iki izinle kapılar", () => {
    const p = src("./DeliveryNoteCancelPanel.tsx");
    expect(p).toContain("getDeliveryNoteCancelPreview(");
    expect(p).toMatch(/moving \? \[\.\.\.selected\] : undefined/);
    expect(p).toContain('["finance:write", "finance:cheque"]');
  });
});
