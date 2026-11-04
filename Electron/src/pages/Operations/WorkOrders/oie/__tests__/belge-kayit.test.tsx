// Belgeden iş emri (K6–K9): okunan taslak form kutularını doldurur (müşteri önerisi · parti no · metre · varsayılan gramaj);
// review'lı metre kaydı bekletir; WITH_WORK_ORDER → sözleşme 3 ucu, SEPARATE → taslağa yama (uç çağrılmaz); toplu kayıt
// satır başına sonuç; refakat oto baskı yalnız ayar açıkken.
// Negatif sonda: `docDraftReasons`tan review şartı kaldırılınca "review'lı metre" vakaları kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { applyPatch, docDraftReasons, gramajOffer, initialDocDraft, noteWorkOrderBody, passThroughTargets, routeGramajOptions, seedDraftGramaj } from "../docDraft";
import type { DefaultTarget } from "@/lib/station-default-targets";
import { routeHasKursunStep } from "../service";
import { saveLabel, saveDoc } from "../saveDoc";
import { formEndpointExtras, type ClassicPayloadPart } from "../docFormFill";
import { batchFailure } from "../batchToken";
import { TopluBelgeForm } from "../TopluBelgeForm";

const createWO = vi.fn();
vi.mock("../service", async (orig) => ({ ...(await orig<typeof import("../service")>()), createWorkOrderFromNote: (...a: unknown[]) => createWO(...a) }));
const patchHeader = vi.fn();
const getNote = vi.fn();
vi.mock("@/pages/Operations/GelenBelgeler/service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  updateNoteHeader: (...a: unknown[]) => patchHeader(...a),
  getDeliveryNote: (id: string) => getNote(id),
}));
vi.mock("@/lib/kursun-gramaj", async (orig) => ({
  ...(await orig<typeof import("@/lib/kursun-gramaj")>()),
  useKursunGramajCatalog: () => ({ catalog: { propertyId: "p-kursun", options: [{ id: "g1", name: "1 gr" }, { id: "g2", name: "2 gr", isDefault: true }] }, isLoading: false }),
}));
// K22 çözücü cevabı (müşteri başına); `undefined` = henüz yok.
const TG = (propertyId: string, valueId: string, propertyCode = propertyId): DefaultTarget => ({
  propertyId, propertyCode, propertyName: propertyCode, valueType: "CHOICE", mode: "REQUIRED", variantOfPropertyId: null, valueId, valueCode: valueId, valueName: valueId, source: "VALUE_DEFAULT",
});
const resolver: { targets: readonly DefaultTarget[] | null | undefined } = { targets: [TG("p-kursun", "g2")] };
vi.mock("../useOieDefaults", () => ({ useOieDefaultTargets: () => () => resolver.targets }));
const approval = { value: "WITH_WORK_ORDER" as "WITH_WORK_ORDER" | "SEPARATE" };
vi.mock("../useFormApproval", () => ({ useFormApproval: () => ({ value: approval.value, isLoading: false }) }));
const autoPrint = { on: false };
const printCard = vi.fn((_id: string) => Promise.resolve("PRINTED"));
vi.mock("../refakatPrint", () => ({
  useRefakatAutoPrint: () => autoPrint.on,
  printRefakatCard: (id: string) => printCard(id),
  AUTO_PRINT_TEXT: { PRINTED: "basıldı", CANCELLED: "", NO_CARD: "", FAILED: "" },
}));
vi.mock("../BulkRow", () => ({
  BulkRow: ({ note, result }: { note?: { id: string }; result?: { kind: string; text: string } }) => (
    <div data-testid={`row-${note?.id ?? "?"}`}>{result ? `${result.kind}:${result.text}` : "hazır"}</div>
  ),
}));

const note = (over: Record<string, unknown> = {}) => ({
  id: "n1", noteNo: "GB-1", status: "DRAFT", ownerCustomerId: null, ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279",
  kursunMeters: "4521.5", kursunMetersSource: "OUTPUT", kursunMetersReview: false,
  ownerSuggestion: { customerId: "c-gul", name: "Gülkesim", matchedText: "GÜLKESİM" },
  scans: [{ id: "s1", pageNo: 1, regionNo: null, status: "READ", mimeType: "image/jpeg", attempts: 1 }], lines: [], ...over,
});
const gramaj = [{ id: "g1" }, { id: "g2", isDefault: true }];
/** Taslak + çözücü teklifi (sunucu "g2" önerir). */
const draftOf = (n: unknown, options: readonly { id: string }[] = gramaj) => seedDraftGramaj(initialDocDraft(n as never), gramajOffer([TG("p-kursun", "g2")], "p-kursun", options));
type N = Parameters<typeof saveDoc>[0]["note"];

beforeEach(() => {
  createWO.mockReset();
  patchHeader.mockReset();
  getNote.mockReset();
  printCard.mockClear();
  approval.value = "WITH_WORK_ORDER";
  autoPrint.on = false;
  resolver.targets = [TG("p-kursun", "g2")];
});

describe("belgeden form taslağı", () => {
  it("⭐ kutular dolar: müşteri önerisi (Belgeden), parti no + anahtar, metre, çözücünün gramajı", () => {
    expect(initialDocDraft(note() as never).gramajId).toBeNull();
    const d = draftOf(note());
    expect(d).toMatchObject({ ownerCustomerId: "c-gul", ownerFromDoc: true, ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279", meters: 4521.5, gramajId: "g2" });
    expect(docDraftReasons(d)).toEqual([]);
  });
  it("öneri yoksa müşteri boş; katalogda olmayan teklif seçilmez", () => {
    const d = draftOf(note({ ownerSuggestion: null }), [{ id: "g1" }]);
    expect(d.ownerCustomerId).toBeNull();
    expect(d.gramajId).toBeNull();
    expect(docDraftReasons(d)).toContain("Müşteriyi seçin.");
  });
  it("⭐ review'lı metre doğrulanmadan kayıt yok", () => {
    const d = draftOf(note({ kursunMetersReview: true }));
    expect(docDraftReasons(d)).toEqual(["Kurşun metresini doğrulayın (Gözden geçir)."]);
  });
  it("sözleşme 3 gövdesi: Decimal metni, anahtarlı parti, gramaj hedefi", () => {
    const body = noteWorkOrderBody(draftOf(note()), { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun" });
    expect(body).toEqual({ clientToken: "t1", ownerCustomerId: "c-gul", ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279", kursunMeters: "4521.5", routeTemplateId: "rt-k", targetValues: [{ propertyId: "p-kursun", valueId: "g2" }] });
  });
  it("⭐ K29 rotasız (routeTemplateId null): gövdede rota anahtarı HİÇ yok, kalan alanlar aynı", () => {
    const body = noteWorkOrderBody(draftOf(note()), { clientToken: "t1", routeTemplateId: null, gramajPropertyId: "p-kursun" });
    expect("routeTemplateId" in body).toBe(false);
    expect(body).toEqual({ clientToken: "t1", ownerCustomerId: "c-gul", ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279", kursunMeters: "4521.5", targetValues: [{ propertyId: "p-kursun", valueId: "g2" }] });
  });
  it("⭐ formda temizlenen parti no gövdede null gider (sunucu okumada yazılanı siler)", () => {
    const d = applyPatch(draftOf(note()), { ourBatchNo: null });
    const body = noteWorkOrderBody(d, { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun" });
    expect(body.ourBatchNo).toBeNull();
    expect("ourBatchNoKey" in body).toBe(false);
  });
  it("⭐ kurşunsuz rotada gramaj ön seçilmez, gövdede hedef boş; bilinmeyen rota bugünkü gibi", () => {
    const d = draftOf(note(), routeGramajOptions(gramaj, false));
    expect(d.gramajId).toBeNull();
    expect(noteWorkOrderBody(d, { clientToken: "t1", routeTemplateId: "rt-t", gramajPropertyId: "p-kursun" }).targetValues).toEqual([]);
    expect(draftOf(note(), routeGramajOptions(gramaj, undefined)).gramajId).toBe("g2");
  });
  it("⭐ K22 'Hedef yok' gövdede AÇIK boş dizi (sunucu anahtarsız gövdeye değer dayatmaz); formda alanı olmayan değer aynen gider, kat gitmez", () => {
    const none = { ...draftOf(note()), gramajId: null, gramajTouched: true };
    expect(noteWorkOrderBody(none, { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun" }).targetValues).toEqual([]);
    const pass = passThroughTargets([TG("p-kursun", "g2"), TG("p-brode", "b1"), TG("p-kat", "k4", "KAT")], "p-kursun");
    expect(pass).toEqual([{ propertyId: "p-brode", valueId: "b1" }]);
    expect(noteWorkOrderBody(none, { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun", passThrough: pass }).targetValues).toEqual([{ propertyId: "p-brode", valueId: "b1" }]);
  });
  it("⭐ K22 müşteri değişince teklif yeniden tohumlanır; elle seçim ezilmez; cevap yokken dokunulmaz", () => {
    const d0 = seedDraftGramaj(initialDocDraft(note() as never), "g2");
    expect(seedDraftGramaj(d0, undefined)).toBe(d0);
    const d1 = seedDraftGramaj(applyPatch(d0, { ownerCustomerId: "c-ist" }), "g1");
    expect(d1.gramajId).toBe("g1");
    expect(seedDraftGramaj(d1, "g2")).toBe(d1);
    const touched = { ...d1, gramajId: null, gramajTouched: true };
    expect(seedDraftGramaj(applyPatch(touched, { ownerCustomerId: "c-gul" }), "g2").gramajId).toBeNull();
  });
  it("routeHasKursunStep: sunucu alanı önce, yoksa PROCESS_QC yedeği", () => {
    expect(routeHasKursunStep([{ station: { kind: "PROCESS_QC", isKursunStation: false } }, { station: { kind: "TAMBUR" } }])).toBe(false);
    expect(routeHasKursunStep([{ station: { kind: "INTERNAL", isKursunStation: true } }])).toBe(true);
    expect(routeHasKursunStep([{ station: { kind: "PROCESS_QC" } }])).toBe(true);
  });
  it("⭐ tam metin önerisi (FULL_TEXT) sahip alanına yazılmaz; OWNER_TEXT / alansız (eski) yazılır", () => {
    const full = draftOf(note({ ownerSuggestion: { customerId: "c-ist", name: "İstanbul Tekstil", matchedText: "Güngören / İSTANBUL", source: "FULL_TEXT" } }));
    expect(full.ownerCustomerId).toBeNull();
    expect(full.ownerFromDoc).toBe(false);
    const own = draftOf(note({ ownerSuggestion: { customerId: "c-gul", name: "Gülkesim", matchedText: "GÜLKESİM", source: "OWNER_TEXT" } }));
    expect(own.ownerCustomerId).toBe("c-gul");
  });
});

describe("saveDoc", () => {
  const base = (n: ReturnType<typeof note>) => ({ note: n as unknown as N, draft: draftOf(n), routeTemplateId: "rt-k", gramajPropertyId: "p-kursun", clientToken: "t1" });
  it("⭐ WITH_WORK_ORDER → belge→iş emri ucu, taslak yaması yok", async () => {
    createWO.mockResolvedValue({ workOrderId: "w1", workOrderNo: "IE-1", batchNumber: "214279", rollId: "r1" });
    const out = await saveDoc({ ...base(note()), formApproval: "WITH_WORK_ORDER" });
    expect(out).toEqual({ kind: "WORK_ORDER", result: expect.objectContaining({ workOrderNo: "IE-1" }) });
    expect(createWO).toHaveBeenCalledWith("n1", expect.objectContaining({ routeTemplateId: "rt-k", kursunMeters: "4521.5" }));
    expect(patchHeader).not.toHaveBeenCalled();
  });
  it("⭐ ayar kapalı (SEPARATE) → bugünkü yol: taslağa yazılır, uç çağrılmaz", async () => {
    const out = await saveDoc({ ...base(note()), formApproval: "SEPARATE" });
    expect(out).toEqual({ kind: "DRAFT_SAVED" });
    expect(createWO).not.toHaveBeenCalled();
    expect(patchHeader).toHaveBeenCalledWith("n1", { ownerCustomerId: "c-gul" });
  });
  it("review'lı metre → hiçbir uç çağrılmaz", async () => {
    await expect(saveDoc({ ...base(note({ kursunMetersReview: true })), formApproval: "WITH_WORK_ORDER" })).rejects.toThrow(/doğrulayın/);
    expect(createWO).not.toHaveBeenCalled();
  });

  // S16d: klasik formdan gelen `extra` gövdeye biner; formun hedefleri (targetValues) taslağın gramaj/geçiş değerlerini EZER.
  const FORM: ClassicPayloadPart = { targetItemId: "item-1", targetColorId: "color-1", width: 280, targetQuantity: 4500, targetWeight: 1200, plannedStartDate: null, plannedEndDate: null, foldType: "2-KAT" };
  it("⭐ extra (klasik form) gövdeye karışır; targetValues=[] gramaj teklifini ezer", async () => {
    createWO.mockResolvedValue({ workOrderId: "w1", workOrderNo: "IE-1", batchNumber: "214279", rollId: "r1" });
    await saveDoc({ ...base(note()), formApproval: "WITH_WORK_ORDER", extra: { ...formEndpointExtras(FORM, false), targetValues: [] } });
    const body = createWO.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ routeTemplateId: "rt-k", kursunMeters: "4521.5", targetItemId: "item-1", targetColorId: "color-1", width: 280, targetQuantity: 4500, targetWeight: 1200, foldType: "2-KAT" });
    expect(body.targetValues).toEqual([]);
  });
  it("⭐ PER_PARTY çok parti: gövdede hedef metraj/kg YOK (sunucu 400), parti gövdesi var", async () => {
    createWO.mockResolvedValue({ workOrderId: "w1", workOrderNo: "IE-1", batchNumber: "P1", rollId: "r1", workOrders: [] });
    const multi = { mode: "PER_PARTY" as const, rows: [{ blockNo: 1, batchNo: "P1", meters: 586 }, { blockNo: 2, batchNo: "P2", meters: 3935 }] };
    await saveDoc({ ...base(note()), formApproval: "WITH_WORK_ORDER", multi, extra: { ...formEndpointExtras(FORM, true), targetValues: [] } });
    const body = createWO.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("targetQuantity");
    expect(body).not.toHaveProperty("targetWeight");
    expect(body).toMatchObject({ mode: "PER_PARTY", targetItemId: "item-1", width: 280 });
  });
  it("SEPARATE: extra hiçbir uca gitmez, yalnız belge başlığı taslağa yazılır (kart bunu uyarır)", async () => {
    await saveDoc({ ...base(note()), formApproval: "SEPARATE", extra: { ...formEndpointExtras(FORM, false), targetValues: [] } });
    expect(createWO).not.toHaveBeenCalled();
    expect(patchHeader).toHaveBeenCalledWith("n1", { ownerCustomerId: "c-gul" });
  });
});

describe("toplu kayıt", () => {
  it("batchFailure: belirsiz hata önce (token yapışır), yoksa ilk kesin hata, hatasızsa undefined", () => {
    const amb = { response: { status: 503 } };
    const hard = { response: { status: 422 } };
    expect(batchFailure([])).toBeUndefined();
    expect(batchFailure([hard])).toBe(hard);
    expect(batchFailure([hard, amb])).toBe(amb);
  });
  it("⭐ biri düşer diğeri sürer: satır başına sonuç; oto baskı açıkken açılan için kart basılır", async () => {
    autoPrint.on = true;
    getNote.mockImplementation((id: string) => Promise.resolve(note({ id, noteNo: id })));
    createWO.mockImplementation((id: string) => (id === "n1" ? Promise.reject(new Error("Rota bulunamadı")) : Promise.resolve({ workOrderId: "w2", workOrderNo: "IE-2", batchNumber: null, rollId: null })));
    renderWithProviders(<TopluBelgeForm noteIds={["n1", "n2"]} route={{ id: "rt-k", name: "K" }} />);
    const save = await screen.findByTestId("oie-bulk-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("row-n2")).toHaveTextContent("OK:Terbiye İş Emri IE-2"));
    expect(screen.getByTestId("row-n1")).toHaveTextContent("FAILED:");
    expect(createWO).toHaveBeenCalledTimes(2);
    expect(printCard).toHaveBeenCalledWith("w2");
    expect(printCard).toHaveBeenCalledTimes(1);
  });
  it("⭐ K22 toplu satır gövdesi çözücünün gramajını + iletilen değeri taşır; cevap gelmeden kayıt kapalı", async () => {
    getNote.mockImplementation((id: string) => Promise.resolve(note({ id })));
    createWO.mockResolvedValue({ workOrderId: "w4", workOrderNo: "IE-4", batchNumber: null, rollId: null });
    resolver.targets = undefined;
    const view = renderWithProviders(<TopluBelgeForm noteIds={["n4"]} route={{ id: "rt-k", name: "K" }} />);
    await screen.findByTestId("row-n4");
    expect(screen.getByTestId("oie-bulk-save")).toBeDisabled();
    resolver.targets = [TG("p-kursun", "g1"), TG("p-brode", "b1")];
    view.rerender(<TopluBelgeForm noteIds={["n4"]} route={{ id: "rt-k", name: "K" }} />);
    const save = screen.getByTestId("oie-bulk-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(createWO).toHaveBeenCalledTimes(1));
    expect((createWO.mock.calls[0]?.[1] as { targetValues?: unknown } | undefined)?.targetValues).toEqual([{ propertyId: "p-kursun", valueId: "g1" }, { propertyId: "p-brode", valueId: "b1" }]);
  });
  it("oto baskı kapalıyken kart basılmaz", async () => {
    getNote.mockImplementation((id: string) => Promise.resolve(note({ id })));
    createWO.mockResolvedValue({ workOrderId: "w3", workOrderNo: "IE-3", batchNumber: null, rollId: null });
    renderWithProviders(<TopluBelgeForm noteIds={["n3"]} route={{ id: "rt-k", name: "K" }} />);
    const save = await screen.findByTestId("oie-bulk-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("row-n3")).toHaveTextContent("OK:"));
    expect(printCard).not.toHaveBeenCalled();
  });
});

describe("kaydet düğmesi", () => {
  it("iş emrini açan kayıt düğmesi '<Terbiye İş Emri> oluştur' (çıplak 'Kaydet' değil)", () => {
    expect(saveLabel()).toBe("Terbiye İş Emri oluştur");
  });
});
