// Detay sadeleştirme (2026-11-10): tek "Dikkat" kutusu (uyarı yoksa çizilmez) · başlıkta yalnız birincil eylem, ikinciller
// "⋯ Diğer" menüsünde (izin yoksa madde yok, madde aynı diyaloğu açar) · "Diğer bilgiler" kapalı başlar · "+ Satır ekle" formu açar.
// Negatif sonda: `attentionKinds` boş dönünce kutu yine çizilirse §1 kırmızı; NoticesStrip kutu dışına alınırsa §2 kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";
import { NoteHeaderForm } from "../NoteHeaderForm";
import type { DeliveryNoteDetail } from "../types";

vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), post: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const perms = new Set<string>();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.has(p), isAdmin: false }) }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, statusLine, actions }: { title: string; statusLine?: ReactNode; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p data-testid="status-line">{statusLine}</p>
      <div data-testid="header-actions">{actions}</div>
    </div>
  ),
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => null }));
vi.mock("@/components/forms/DatePickerInput", () => ({ DatePickerInput: () => null }));
vi.mock("../ScanViewer", () => ({ ScanViewer: () => null }));
vi.mock("../LinesTable", () => ({ LinesTable: () => null }));
vi.mock("../CellReviewDialog", () => ({ CellReviewDialog: () => null }));
vi.mock("../ApproveDialog", () => ({ ApproveDialog: () => null }));
vi.mock("../ProcessGramajPanel", () => ({ ProcessGramajPanel: () => null }));
vi.mock("../PartiesCard", () => ({ PartiesCard: () => null }));
vi.mock("../OpenWorkOrderAction", () => ({ OpenWorkOrderAction: () => <button type="button">İş emri aç</button> }));
vi.mock("../CancelNoteDialog", () => ({ CancelNoteDialog: () => <div data-testid="cancel-dialog" /> }));
vi.mock("../useNoteTabTitle", () => ({ useNoteTabTitle: () => false }));

const base = (o: Partial<DeliveryNoteDetail> = {}): DeliveryNoteDetail =>
  ({
    id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", templateId: "t1", ownerCustomerId: null, senderCustomerId: null, senderText: null,
    senderDocNo: null, senderDocDate: null, customerBatchNo: null, customerOrderNo: null, processText: null, pageCount: null, declaredTopCount: null,
    varianceReason: null, updatedAt: "2026-11-10T08:00:00.000Z", scans: [], lines: [], ...o,
  }) as DeliveryNoteDetail;

let current = base();
const idle = { mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock("../useNoteDetail", () => ({
  useNoteDetail: () => ({ note: { data: current, isError: false }, suggestions: { data: undefined }, header: idle, line: idle, removeLine: idle, invalidate: vi.fn() }),
}));

const badTotals = { ok: false, tolerance: 0, blocks: [], mismatches: [], warnings: [] };

describe("detay sadeleştirme", () => {
  beforeEach(() => {
    perms.clear();
    ["gelen-belge:read", "gelen-belge:write", "gelen-belge:approve"].forEach((p) => perms.add(p));
    current = base();
  });

  it("§1 uyarı yokken Dikkat kutusu çizilmez; durum satırında 'Kaynak' yok", () => {
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("detail-attention")).toBeNull();
    expect(screen.getByTestId("status-line").textContent).not.toMatch(/Kaynak/);
  });

  it("§2 cari kilidi + toplam TUTMUYOR + okuma uyarıları TEK kutuda; tutmuyor hükmü şeritte tekrar basılmaz", () => {
    current = base({ cariHold: { sebepEtiketi: "x", koyan: "y", message: "Borç limiti aşıldı" }, totalsCheck: badTotals, notices: [{ code: "GRID_EMPTY", title: "El yazısı okunamadı", detail: "" }] });
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.getAllByTestId("detail-attention")).toHaveLength(1);
    const box = within(screen.getByTestId("detail-attention"));
    expect(box.getByTestId("attention-cari")).toHaveTextContent("Borç limiti aşıldı");
    expect(box.getByTestId("attention-totals")).toHaveTextContent("Toplamlar tutmuyor");
    expect(box.getByTestId("notices-strip")).toHaveTextContent("El yazısı okunamadı");
    expect(screen.queryByTestId("totals-verdict")).toBeNull();
  });

  it("§3 başlıkta yalnız Onayla görünür; Sayfa ekle / Taslağı iptal et / Excel '⋯ Diğer' menüsünde", async () => {
    renderWithProviders(<IncomingDocumentDetailPage />);
    const actions = within(screen.getByTestId("header-actions"));
    expect(actions.getByRole("button", { name: /Onayla/ })).toBeInTheDocument();
    expect(actions.queryByRole("button", { name: /Sayfa ekle/ })).toBeNull();
    expect(screen.queryByTestId("note-delete-draft")).toBeNull();
    await userEvent.click(screen.getByTestId("note-more-menu"));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Sayfa ekle", "Excel'den satır yükle", "Excel şablonunu indir", "Taslağı iptal et"]);
  });

  it("§4 onaylı belge: birincil 'İş emri aç'; iptal maddesi izinle var ve diyaloğu açar, izinsiz yok", async () => {
    current = base({ status: "APPROVED" });
    perms.add("gelen-belge:cancel");
    const { unmount } = renderWithProviders(<IncomingDocumentDetailPage />);
    expect(within(screen.getByTestId("header-actions")).getByRole("button", { name: "İş emri aç" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("note-more-menu"));
    await userEvent.click(screen.getByTestId("note-cancel"));
    expect(screen.getByTestId("cancel-dialog")).toBeInTheDocument();
    unmount();
    perms.delete("gelen-belge:cancel");
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("note-more-menu")).toBeNull();
    expect(screen.queryByTestId("note-cancel")).toBeNull();
  });

  it("§5 '+ Satır ekle' formu açar, 'Kapat' kapatır", async () => {
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("add-line-form")).toBeNull();
    await userEvent.click(screen.getByTestId("add-line-open"));
    expect(screen.getByTestId("add-line-form")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("add-line-close"));
    expect(screen.queryByTestId("add-line-form")).toBeNull();
  });
});

describe("Belge bilgileri kartı", () => {
  it("§6 'Diğer bilgiler' varsayılan kapalı; birincil alanlar kart başında", () => {
    render(<NoteHeaderForm note={base()} suggestions={undefined} editable onPatch={vi.fn()} />);
    expect((screen.getByTestId("note-other-info") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByLabelText("Gönderen belge no")).toBeInTheDocument();
  });

  it("§7 ikincil alana dokunan uyarı (parti no farklı okundu) varsa açık başlar", () => {
    render(<NoteHeaderForm note={base({ notices: [{ code: "BATCH_NO_DIFFERS", title: "Parti no farklı okundu", detail: "" }] })} suggestions={undefined} editable onPatch={vi.fn()} />);
    expect((screen.getByTestId("note-other-info") as HTMLDetailsElement).open).toBe(true);
  });
});
