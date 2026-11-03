// Gülkesim K27 WARN + formApproval=WITH_WORK_ORDER: iş emri formundan kayıt 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE`
// → genel "Kaydedilemedi" yerine eş künyesi kutusu; "Yine de onayla" gövdeye `confirmDuplicateDocNo: true` ekleyip yeniden
// gönderir (tekli form + toplu satır). BLOCK kodu bugünkü genel hata metninde kalır.
// Negatif sonda: `noteWorkOrderBody` çağrısından bayrak düşürülünce "Yine de onayla" vakaları kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { initialDocDraft } from "../docDraft";
import { saveDoc } from "../saveDoc";
import { BelgedenIsEmriForm } from "../BelgedenIsEmriForm";
import { TopluBelgeForm } from "../TopluBelgeForm";

const createWO = vi.fn();
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  createWorkOrderFromNote: (...a: unknown[]) => createWO(...a),
  getNoteParties: () => Promise.resolve(null),
}));
const getNote = vi.fn();
vi.mock("@/pages/Operations/GelenBelgeler/service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  updateNoteHeader: () => Promise.resolve(),
  getDeliveryNote: (id: string) => getNote(id),
}));
vi.mock("@/pages/Operations/GelenBelgeler/useNoteDetail", () => ({ useNoteDetail: (id: string) => ({ note: { data: note({ id }), isError: false }, invalidate: () => Promise.resolve() }) }));
vi.mock("@/lib/kursun-gramaj", async (orig) => ({
  ...(await orig<typeof import("@/lib/kursun-gramaj")>()),
  useKursunGramajCatalog: () => ({ catalog: { propertyId: "p-kursun", options: [{ id: "g2", name: "2 gr", isDefault: true }] }, isLoading: false }),
}));
vi.mock("../useOieDefaults", () => ({ useOieDefaultTargets: () => () => [] }));
vi.mock("../useFormApproval", () => ({ useFormApproval: () => ({ value: "WITH_WORK_ORDER", isLoading: false }) }));
vi.mock("../refakatPrint", () => ({ useRefakatAutoPrint: () => false, printRefakatCard: () => Promise.resolve("PRINTED"), AUTO_PRINT_TEXT: { PRINTED: "" } }));
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ navigateActive, openTab: vi.fn() }) }));
vi.mock("../DocFields", () => ({ DocFields: () => <div />, FromDocBadge: () => <span /> }));
vi.mock("../DocThumb", () => ({ DocThumb: () => <div /> }));
vi.mock("@/pages/Operations/GelenBelgeler/tanit/TeachEntry", () => ({ TeachButton: () => null, UnknownTypeStrip: () => null }));
vi.mock("../BulkRow", () => ({
  BulkRow: ({ note, result }: { note?: { id: string }; result?: { kind: string; text: string } }) => (
    <div data-testid={`row-${note?.id ?? "?"}`}>{result ? `${result.kind}:${result.text}` : "hazır"}</div>
  ),
}));

function note(over: Record<string, unknown> = {}) {
  return {
    id: "n1", noteNo: "GB-0009", status: "DRAFT", ownerCustomerId: "c-gul", ourBatchNo: null, ourBatchNoKey: null,
    kursunMeters: "100", kursunMetersSource: "OUTPUT", kursunMetersReview: false, ownerSuggestion: null, scans: [], lines: [], ...over,
  };
}
const PEERS = [{ id: "p1", noteNo: "GB-0007", status: "APPROVED", workOrderNumbers: ["IE-12"] }];
const err409 = (code: string, details: object = {}) =>
  new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message: "Aynı belge no kayıtlı", details: { code, ...details } } } as AxiosResponse);
const ACTIVE = () => err409("DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", { senderDocNo: "17", peers: PEERS });
const WO = { workOrderId: "w1", workOrderNo: "IE-13", batchNumber: null, rollId: "r1" };
const flagOf = (call: number) => (createWO.mock.calls[call]?.[1] as { confirmDuplicateDocNo?: boolean } | undefined)?.confirmDuplicateDocNo;

beforeEach(() => {
  createWO.mockReset();
  getNote.mockReset();
  navigateActive.mockReset();
});

describe("saveDoc gövdesi", () => {
  const input = { note: note() as never, draft: initialDocDraft(note() as never), routeTemplateId: "rt", formApproval: "WITH_WORK_ORDER" as const, gramajPropertyId: null, clientToken: "t1" };
  it("onay bayrağı yalnız istenince gövdeye girer (bugünkü gövde değişmez)", async () => {
    createWO.mockResolvedValue(WO);
    await saveDoc(input);
    await saveDoc({ ...input, confirmDuplicateDocNo: true });
    expect(createWO.mock.calls[0]?.[1]).not.toHaveProperty("confirmDuplicateDocNo");
    expect(flagOf(1)).toBe(true);
  });
});

describe("tekli form (Belgeden iş emri)", () => {
  it("⭐ 409 ACTIVE → eş künyesi kutusu (genel hata yok); 'Yine de onayla' bayrakla yeniden gönderir, iş emri açılır", async () => {
    createWO.mockRejectedValueOnce(ACTIVE()).mockResolvedValueOnce(WO);
    renderWithProviders(<BelgedenIsEmriForm noteId="n1" route={{ id: "rt", name: "Kurşun" }} />);
    const save = await screen.findByTestId("oie-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    const box = await screen.findByTestId("duplicate-doc-no-confirm");
    expect(box).toHaveTextContent("GB-0007");
    expect(screen.queryByTestId("oie-error")).toBeNull();
    expect(flagOf(0)).toBeUndefined();
    await userEvent.click(within(box).getByTestId("duplicate-doc-no-force"));
    await waitFor(() => expect(navigateActive).toHaveBeenCalledWith("/operations/work-orders/w1"));
    expect(createWO).toHaveBeenCalledTimes(2);
    expect(flagOf(1)).toBe(true);
  });
  it("BLOCK kodu (DUPLICATE_DOC_NO) bugünkü genel hata metninde kalır, kutu yok", async () => {
    createWO.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO"));
    renderWithProviders(<BelgedenIsEmriForm noteId="n1" route={{ id: "rt", name: "Kurşun" }} />);
    const save = await screen.findByTestId("oie-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    expect(await screen.findByTestId("oie-error")).toHaveTextContent("Aynı belge no kayıtlı");
    expect(screen.queryByTestId("duplicate-doc-no-confirm")).toBeNull();
  });
});

describe("toplu kayıt", () => {
  it("⭐ satır 409 ACTIVE → satır altında kutu; onay yalnız o satırı bayrakla yeniden gönderir", async () => {
    getNote.mockImplementation((id: string) => Promise.resolve(note({ id, noteNo: id })));
    createWO.mockImplementation((id: string) => (id === "n1" && createWO.mock.calls.length === 1 ? Promise.reject(ACTIVE()) : Promise.resolve({ ...WO, workOrderNo: `IE-${id}` })));
    renderWithProviders(<TopluBelgeForm noteIds={["n1", "n2"]} route={{ id: "rt", name: "K" }} />);
    const save = await screen.findByTestId("oie-bulk-save");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("row-n2")).toHaveTextContent("OK:"));
    const box = await screen.findByTestId("duplicate-doc-no-confirm");
    expect(screen.getByTestId("row-n1")).toHaveTextContent("DUPLICATE:");
    await userEvent.click(within(box).getByTestId("duplicate-doc-no-force"));
    await waitFor(() => expect(screen.getByTestId("row-n1")).toHaveTextContent("OK:"));
    expect(createWO).toHaveBeenCalledTimes(3);
    expect(createWO.mock.calls[2]?.[0]).toBe("n1");
    expect(flagOf(2)).toBe(true);
    expect(screen.queryByTestId("duplicate-doc-no-confirm")).toBeNull();
  });
});
