// Belgeden iş emri (K6–K9): okunan taslak form kutularını doldurur (müşteri önerisi · parti no · metre · varsayılan gramaj);
// review'lı metre kaydı bekletir; WITH_WORK_ORDER → sözleşme 3 ucu, SEPARATE → taslağa yama (uç çağrılmaz); toplu kayıt
// satır başına sonuç; refakat oto baskı yalnız ayar açıkken.
// Negatif sonda: `docDraftReasons`tan review şartı kaldırılınca "review'lı metre" vakaları kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { applyPatch, docDraftReasons, initialDocDraft, noteWorkOrderBody, routeGramajOptions } from "../docDraft";
import { routeHasKursunStep } from "../service";
import { SAVE_LABEL, saveDoc } from "../saveDoc";
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
vi.mock("@/lib/kursun-gramaj", () => ({ useKursunGramajCatalog: () => ({ catalog: { propertyId: "p-kursun", options: [{ id: "g1", name: "1 gr" }, { id: "g2", name: "2 gr", isDefault: true }] }, isLoading: false }) }));
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
type N = Parameters<typeof saveDoc>[0]["note"];

beforeEach(() => {
  createWO.mockReset();
  patchHeader.mockReset();
  getNote.mockReset();
  printCard.mockClear();
  approval.value = "WITH_WORK_ORDER";
  autoPrint.on = false;
});

describe("belgeden form taslağı", () => {
  it("⭐ kutular dolar: müşteri önerisi (Belgeden), parti no + anahtar, metre, varsayılan gramaj", () => {
    const d = initialDocDraft(note() as never, gramaj);
    expect(d).toMatchObject({ ownerCustomerId: "c-gul", ownerFromDoc: true, ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279", meters: 4521.5, gramajId: "g2" });
    expect(docDraftReasons(d)).toEqual([]);
  });
  it("öneri yoksa müşteri boş; varsayılan gramaj alanı yoksa hiçbiri seçilmez", () => {
    const d = initialDocDraft(note({ ownerSuggestion: null }) as never, [{ id: "g1" }]);
    expect(d.ownerCustomerId).toBeNull();
    expect(d.gramajId).toBeNull();
    expect(docDraftReasons(d)).toContain("Müşteriyi seçin.");
  });
  it("⭐ review'lı metre doğrulanmadan kayıt yok", () => {
    const d = initialDocDraft(note({ kursunMetersReview: true }) as never, gramaj);
    expect(docDraftReasons(d)).toEqual(["Kurşun metresini doğrulayın (Gözden geçir)."]);
  });
  it("sözleşme 3 gövdesi: Decimal metni, anahtarlı parti, gramaj hedefi", () => {
    const body = noteWorkOrderBody(initialDocDraft(note() as never, gramaj), { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun" });
    expect(body).toEqual({ clientToken: "t1", ownerCustomerId: "c-gul", ourBatchNo: "214279", ourBatchNoKey: "BARCODE:214279", kursunMeters: "4521.5", routeTemplateId: "rt-k", targetValues: [{ propertyId: "p-kursun", valueId: "g2" }] });
  });
  it("⭐ formda temizlenen parti no gövdede null gider (sunucu okumada yazılanı siler)", () => {
    const d = applyPatch(initialDocDraft(note() as never, gramaj), { ourBatchNo: null });
    const body = noteWorkOrderBody(d, { clientToken: "t1", routeTemplateId: "rt-k", gramajPropertyId: "p-kursun" });
    expect(body.ourBatchNo).toBeNull();
    expect("ourBatchNoKey" in body).toBe(false);
  });
  it("⭐ kurşunsuz rotada varsayılan gramaj ön seçilmez, gövdede hedef yok; bilinmeyen rota bugünkü gibi", () => {
    const d = initialDocDraft(note() as never, routeGramajOptions(gramaj, false));
    expect(d.gramajId).toBeNull();
    expect(noteWorkOrderBody(d, { clientToken: "t1", routeTemplateId: "rt-t", gramajPropertyId: "p-kursun" }).targetValues).toBeUndefined();
    expect(initialDocDraft(note() as never, routeGramajOptions(gramaj, undefined)).gramajId).toBe("g2");
  });
  it("routeHasKursunStep: sunucu alanı önce, yoksa PROCESS_QC yedeği", () => {
    expect(routeHasKursunStep([{ station: { kind: "PROCESS_QC", isKursunStation: false } }, { station: { kind: "TAMBUR" } }])).toBe(false);
    expect(routeHasKursunStep([{ station: { kind: "INTERNAL", isKursunStation: true } }])).toBe(true);
    expect(routeHasKursunStep([{ station: { kind: "PROCESS_QC" } }])).toBe(true);
  });
  it("⭐ tam metin önerisi (FULL_TEXT) sahip alanına yazılmaz; OWNER_TEXT / alansız (eski) yazılır", () => {
    const full = initialDocDraft(note({ ownerSuggestion: { customerId: "c-ist", name: "İstanbul Tekstil", matchedText: "Güngören / İSTANBUL", source: "FULL_TEXT" } }) as never, gramaj);
    expect(full.ownerCustomerId).toBeNull();
    expect(full.ownerFromDoc).toBe(false);
    const own = initialDocDraft(note({ ownerSuggestion: { customerId: "c-gul", name: "Gülkesim", matchedText: "GÜLKESİM", source: "OWNER_TEXT" } }) as never, gramaj);
    expect(own.ownerCustomerId).toBe("c-gul");
  });
});

describe("saveDoc", () => {
  const base = (n: ReturnType<typeof note>) => ({ note: n as unknown as N, draft: initialDocDraft(n as never, gramaj), routeTemplateId: "rt-k", gramajPropertyId: "p-kursun", clientToken: "t1" });
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
    expect(SAVE_LABEL).toBe("Terbiye İş Emri oluştur");
  });
});
