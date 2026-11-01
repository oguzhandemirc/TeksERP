// Gelen belge ekranları: liste (süzgeç sunucuya), toplam şeridi (blok başına), eşleme önerisi, onay sonucu,
// rejim (modül kapalı → karo ve palet girişi gizli).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";
import { TotalsStrip } from "../TotalsStrip";
import { SuggestionChips } from "../SuggestionChips";
import { ApproveDialog } from "../ApproveDialog";
import { LineRow } from "../LineRow";
import type { DeliveryNoteHeader, DeliveryNoteLine } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions, titleExtra }: { title: string; actions?: ReactNode; titleExtra?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {titleExtra}
      {actions}
    </div>
  ),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));

vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç</button> }));

const listDeliveryNotes = vi.fn();
const approveNote = vi.fn();
const getIncomingDocumentSettings = vi.fn();
const getSuggestions = vi.fn();
vi.mock("../service", () => ({
  getSuggestions: (...a: unknown[]) => getSuggestions(...a),
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  approveNote: (...a: unknown[]) => approveNote(...a),
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => getIncomingDocumentSettings(),
  createManualNote: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
  previewBulkDeleteNotes: vi.fn(),
  applyBulkDeleteNotes: vi.fn(),
}));

const header = (o: Partial<DeliveryNoteHeader>): DeliveryNoteHeader => ({
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", ownerCustomerId: null, senderCustomerId: null,
  senderText: "Akın Tekstil", senderDocNo: "A-77", senderDocDate: null, customerBatchNo: null, processText: null,
  templateId: null, templateScore: null, pageCount: 1, declaredTopCount: null, totalsDeclared: null, varianceReason: null,
  warnings: null, approvedAt: null, cancelledAt: null, createdAt: "2026-10-29T08:00:00Z", updatedAt: "2026-10-29T08:00:00Z",
  ownerCustomer: { id: "c1", code: "C1", name: "Gül Örme" }, senderCustomer: null, _count: { lines: 3, scans: 1 }, ...o,
});
const summary = { DRAFT: 1, APPROVING: 0, APPROVED: 0, PARTIAL: 0, CANCELLED: 0, total: 1 };

beforeEach(() => {
  getIncomingDocumentSettings.mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN" });
  getSuggestions.mockResolvedValue({ noteId: "n1", lines: [], defaultItem: effOf(null) });
  listDeliveryNotes.mockResolvedValue({ items: [header({})], nextCursor: null, summary });
});

describe("liste", () => {
  it("satırları çizer; durum süzgeci SUNUCUYA gider", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    expect(await screen.findByText("GB-0001")).toBeInTheDocument();
    expect(listDeliveryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, status: undefined }));
    const group = screen.getByRole("group", { name: "Durum süzgeci" });
    expect(within(group).getByText(/Tümü \(1\)/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /Onaylandı/ }));
    await waitFor(() => expect(listDeliveryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ status: "APPROVED" })));
  });
  it("liste hatası 'belge yok' gibi gösterilmez", async () => {
    listDeliveryNotes.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<IncomingDocumentsPage />);
    // Ortak DataTable hata satırı (Kumaş Stoğu ile aynı): boş durum metni basılmaz.
    expect(await screen.findByText("Liste yüklenemedi", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Bu süzgece uyan gelen belge yok/)).toBeNull();
  });
});

const ln = (o: Partial<DeliveryNoteLine>) => ({ blockNo: 1, meters: "100", weightKg: null, status: "PENDING", ...o }) as DeliveryNoteLine;

describe("toplam şeridi", () => {
  it("blok başına beyan: tutan yeşil, tutmayan kırmızı + sebep, beyansız doğrulanamaz", () => {
    renderWithProviders(
      <TotalsStrip
        note={{
          lines: [ln({ blockNo: 1 }), ln({ blockNo: 1 }), ln({ blockNo: 2, meters: "50" }), ln({ blockNo: 3 })],
          totalsDeclared: { blocks: [{ blockNo: 1, count: "2", m: "200", kg: null }, { blockNo: 2, count: null, m: "60", kg: null }] },
          declaredTopCount: 5,
        }}
      />,
    );
    expect(screen.getByTestId("block-1").dataset.ok).toBe("true");
    expect(screen.getByTestId("block-2").dataset.ok).toBe("false");
    expect(within(screen.getByTestId("block-2")).getByText("beyan 60 m, satır 50 m")).toBeInTheDocument();
    expect(screen.getByTestId("block-3").dataset.ok).toBe("unknown");
    expect(screen.getByText("Belgede 5 top yazıyor, satır 4 (uyarı)")).toBeInTheDocument();
  });
});

describe("eşleme önerisi", () => {
  it("öğrenilmiş öneri önce; mevcut seçim tekrar önerilmez; tık seçimi uygular", async () => {
    const onPick = vi.fn();
    renderWithProviders(
      <SuggestionChips
        currentId="x"
        onPick={onPick}
        suggestion={{
          rawText: "LACİVERT",
          source: "ALIAS",
          suggested: { id: "c1", code: null, name: "Lacivert", score: 1 },
          list: [{ id: "x", code: null, name: "Seçili", score: 0.95 }, { id: "c2", code: null, name: "Laci", score: 0.84 }],
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Lacivert (öğrenilmiş)", "Laci %84"]);
    await userEvent.click(buttons[1]!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
  });
});

const conflict = (code: string) =>
  new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message: "Toplam tutmuyor", details: { code } } } as AxiosResponse);

describe("onay", () => {
  it("TOTAL_MISMATCH → gerekçe ister; gerekçeyle ikinci deneme → PARTIAL sonucu FAILED satırlarla", async () => {
    approveNote.mockRejectedValueOnce(conflict("TOTAL_MISMATCH")).mockResolvedValueOnce({
      warnings: [],
      result: {
        note: { status: "PARTIAL", lines: [{ status: "FAILED", lineNo: 4, blockNo: 2, failReason: "Ürün çözülemedi" }] },
        summary: { entered: 5, failed: 1, skipped: 0, replayed: 0, rollIds: [] },
      },
    });
    const onDone = vi.fn();
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const reason = await screen.findByLabelText("Fark gerekçesi");
    expect(approveNote).toHaveBeenLastCalledWith("n1", null, []);
    await userEvent.type(reason, "Belgede toplam yanlış");
    await userEvent.click(screen.getByRole("button", { name: "Gerekçeyle onayla" }));
    const res = await screen.findByTestId("approve-result");
    expect(approveNote).toHaveBeenLastCalledWith("n1", "Belgede toplam yanlış", []);
    expect(res.dataset.status).toBe("PARTIAL");
    expect(within(res).getByText("Blok 2, satır 4: Ürün çözülemedi")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it("gerekçe istemeyen 409 (claim çakışması) gerekçe alanı açmaz", async () => {
    approveNote.mockRejectedValueOnce(conflict("CONFLICT"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    expect(await screen.findByTestId("approve-error")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fark gerekçesi")).toBeNull();
  });
});

describe("rejim — modül kapalı → karo ve palet girişi gizli", () => {
  const tile = operationsTiles.find((t) => t.to === "/operations/gelen-belgeler");
  const entry = allCommandEntries.find((e) => e.to === "/operations/gelen-belgeler");
  it("karo ve palet girişi var, ikisi de modül yüklemine bağlı", () => {
    expect(tile?.offHint).toBeUndefined();
    expect(entry?.visibleWhen).toBeTypeOf("function");
    expect(ROUTE_MODULE["operations/gelen-belgeler"]).toBe("gelenBelgeEnabled");
  });
  it("kapalı → ikisi de görünmez; açık → görünür", () => {
    const ctx = (on: boolean) => ({ gelenBelgeEnabled: on }) as Parameters<NonNullable<typeof entry>["visibleWhen"] & object>[0];
    expect(tile!.visibleWhen!(ctx(false))).toBe(false);
    expect(entry!.visibleWhen!(ctx(false))).toBe(false);
    expect(tile!.visibleWhen!(ctx(true))).toBe(true);
    expect(entry!.visibleWhen!(ctx(true))).toBe(true);
  });
});

const dLine = (o: Partial<DeliveryNoteLine>): DeliveryNoteLine => ({
  id: "l1", noteId: "n1", lineNo: 1, blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: "100", weightKg: null, widthCm: null,
  itemText: "SÜPREM", itemId: null, colorText: null, colorId: null, processText: null, confidence: null, needsReview: false,
  sourceRects: null, status: "PENDING", failReason: null, rollId: null, item: null, color: null, ...o,
});
const settingsOf = (o: { mode?: "WARN" | "BLOCK" }) => ({ defaultItem: null, unreviewedApproval: o.mode ?? "WARN", defaultUnreviewedApproval: "WARN" });
function effOf(source: "CUSTOMER" | "FACTORY" | null, name = "Ham Kumaş", problem: string | null = null) {
  return { itemId: source ? "i9" : null, name: source ? name : null, source, usable: source ? !problem : false, problem };
}

describe("hizmet ekseni (E3/E4) — kaynaklı satır ipucu + onay ön kontrolü", () => {
  const row = (line: DeliveryNoteLine, defaultItem: ReturnType<typeof effOf> | undefined) =>
    renderWithProviders(
      <table><tbody>
        <LineRow line={line} suggestion={undefined} editable fixable={false} selected={false} ownerCustomerId="c1" defaultItem={defaultItem}
          onSelect={() => {}} onPatch={() => {}} onDelete={() => {}} onPickItem={() => {}} />
      </tbody></table>,
    );
  it("ürünsüz satır: kaynağa göre ipucu (müşteri/fabrika); yoksa bugünkü 'Kumaş seç' tek başına", () => {
    const a = row(dLine({}), effOf("CUSTOMER", "Gül Ham"));
    expect(screen.getByTestId("default-item-hint").textContent).toBe("Müşteri varsayılanıyla girecek: Gül Ham");
    expect(screen.getByTestId("default-item-hint").dataset.source).toBe("CUSTOMER");
    a.unmount();
    const b = row(dLine({}), effOf("FACTORY"));
    expect(screen.getByTestId("default-item-hint").textContent).toBe("Fabrika varsayılanıyla girecek: Ham Kumaş");
    b.unmount();
    const c = row(dLine({}), effOf(null));
    expect(screen.queryByTestId("default-item-hint")).toBeNull();
    expect(screen.getByRole("button", { name: /Kumaş seç/ })).toBeInTheDocument();
    c.unmount();
    row(dLine({}), undefined);
    expect(screen.queryByTestId("default-item-hint")).toBeNull();
  });
  it("kullanılamaz varsayılan satırda engel olarak görünür", () => {
    row(dLine({}), effOf("CUSTOMER", "Ham", "Ürün pasif."));
    const h = screen.getByTestId("default-item-hint");
    expect(h.dataset.tone).toBe("block");
    expect(h.textContent).toBe("Varsayılan ürün kullanılamıyor (müşteri varsayılanı): Ürün pasif.");
  });
  it("ürünü seçili satırda ipucu yok", () => {
    row(dLine({ itemId: "i1", item: { id: "i1", code: "K1", name: "Süprem" } as DeliveryNoteLine["item"] }), effOf("FACTORY"));
    expect(screen.queryByTestId("default-item-hint")).toBeNull();
  });
  it("WARN: sayaç müşteri varsayılanını ve gözden geçirilmemişi söyler, onay açık", async () => {
    getSuggestions.mockResolvedValue({ noteId: "n1", lines: [], defaultItem: effOf("CUSTOMER", "Gül Ham") });
    renderWithProviders(<ApproveDialog noteId="n1" lines={[dLine({}), dLine({ id: "l2", needsReview: true })]} open onOpenChange={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText("2 satır müşteri varsayılanıyla girecek: Gül Ham")).toBeInTheDocument());
    const box = screen.getByTestId("approve-precheck");
    expect(box.dataset.blocked).toBe("0");
    expect(within(box).getByText("1 satır gözden geçirilmedi — onay uyarıyla geçer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Onayla" })).toBeEnabled();
    expect(getSuggestions).toHaveBeenCalledWith("n1");
  });
  it("kullanılamaz fabrika varsayılanı → engel, buton kapalı", async () => {
    getSuggestions.mockResolvedValue({ noteId: "n1", lines: [], defaultItem: effOf("FACTORY", "Ham", "Ürün pasif.") });
    renderWithProviders(<ApproveDialog noteId="n1" lines={[dLine({})]} open onOpenChange={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("approve-precheck").dataset.blocked).toBe("1"));
    expect(screen.getByText(/fabrika varsayılanı kullanılamıyor: Ürün pasif\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Onayla" })).toBeDisabled();
  });
  it("eşleme okunamazsa yalnız sayar, engel kararı vermez", async () => {
    getSuggestions.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[dLine({})]} open onOpenChange={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText(/1 satırın ürünü seçilmemiş — varsayılan ürün onayda denetlenecek/)).toBeInTheDocument());
    expect(screen.getByTestId("approve-precheck").dataset.blocked).toBe("0");
    expect(screen.getByRole("button", { name: "Onayla" })).toBeEnabled();
  });
  it("BLOCK + gözden geçirilmemiş satır → engellenir, buton kapalı", async () => {
    getIncomingDocumentSettings.mockResolvedValue(settingsOf({ mode: "BLOCK" }));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[dLine({ itemId: "i1", needsReview: true }), dLine({ id: "l3", itemId: "i1", needsReview: true, rollId: "r1", status: "ENTERED" })]} open onOpenChange={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText("1 satır gözden geçirilmeli — onay engellenir.")).toBeInTheDocument());
    expect(screen.getByTestId("approve-precheck").dataset.blocked).toBe("1");
    expect(screen.getByRole("button", { name: "Onayla" })).toBeDisabled();
  });
  it("DELIVERY_NOTE_REVIEW_PENDING / GELEN_BELGE_DEFAULT_ITEM_UNUSABLE → Türkçe yönlendirme", async () => {
    approveNote.mockRejectedValueOnce(conflict("GELEN_BELGE_DEFAULT_ITEM_UNUSABLE"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    expect((await screen.findByTestId("approve-error")).textContent).toContain("varsayılan ürün artık kullanılamıyor; hiç top girilmedi");
    // Kaynaksız (eski backend) hata: müşteri varsayılanı bağlantısı çıkmaz.
    expect(screen.queryByTestId("approve-error-fix-link")).toBeNull();
  });
});
