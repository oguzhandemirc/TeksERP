// Onaylı belgede fiş no / tarih düzelt (2026-11-10): düğme yalnız APPROVED/PARTIAL + `gelen-belge:write`te; diyalog yalnız
// değişen alanı `PATCH /irsaliyeler/:id/kunye`ye yollar; WARN 409 kutusu "Yine de kaydet" bayrakla yeniden gönderir;
// BLOCK/başka hata sunucu mesajıyla satır içinde.
// Negatif sonda (2026-11-10): detay sayfasında `canFixIdentity` `isIdentityFixable(...)` yerine `true` → izinsiz/taslak/iptal
// testi kırmızı; `identityFixBody` değişmeyen alanı da koyunca "yalnız değişen alan" testi kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";
import { identityFixBody } from "../FisNoDuzeltDialog";
import type { DeliveryNoteDetail } from "../types";

const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), post: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), put: vi.fn(), patch: (...a: unknown[]) => patch(...a), delete: vi.fn() },
  apiErrorMessage: (e: { response?: { data?: { message?: string } } }) => e.response?.data?.message ?? "hata",
}));
const perms = new Set<string>();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.has(p), isAdmin: false }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => null }));
vi.mock("@/components/forms/DatePickerInput", () => ({ DatePickerInput: () => null }));
vi.mock("../ScanViewer", () => ({ ScanViewer: () => null }));
vi.mock("../LinesTable", () => ({ LinesTable: () => null }));
vi.mock("../CellReviewDialog", () => ({ CellReviewDialog: () => null }));
vi.mock("../ApproveDialog", () => ({ ApproveDialog: () => null }));
vi.mock("../ProcessGramajPanel", () => ({ ProcessGramajPanel: () => null }));
vi.mock("../PartiesCard", () => ({ PartiesCard: () => null }));
vi.mock("../OpenWorkOrderAction", () => ({ OpenWorkOrderAction: () => null }));
vi.mock("../useNoteTabTitle", () => ({ useNoteTabTitle: () => false }));

const base = (o: Partial<DeliveryNoteDetail> = {}): DeliveryNoteDetail =>
  ({
    id: "n1", noteNo: "GB-0001", status: "APPROVED", sourceKind: "OCR", templateId: "t1", ownerCustomerId: null, senderCustomerId: null, senderText: null,
    senderDocNo: null, senderDocDate: "2026-11-08T00:00:00.000Z", customerBatchNo: null, customerOrderNo: null, processText: null, pageCount: null, declaredTopCount: null,
    varianceReason: null, updatedAt: "2026-11-10T08:00:00.000Z", scans: [], lines: [], ...o,
  }) as DeliveryNoteDetail;

let current = base();
const idle = { mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock("../useNoteDetail", () => ({
  useNoteDetail: () => ({ note: { data: current, isError: false }, suggestions: { data: undefined }, header: idle, line: idle, removeLine: idle, invalidate: vi.fn() }),
}));

const err409 = (code: string, message: string, details: object = {}) =>
  new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message, details: { code, ...details } } } as AxiosResponse);
const PEERS = [{ id: "p1", noteNo: "GB-0007", status: "APPROVED" as const, workOrderNumbers: ["IE-12"] }];

describe("fiş no / tarih düzelt", () => {
  beforeEach(() => {
    perms.clear();
    perms.add("gelen-belge:read").add("gelen-belge:write");
    patch.mockReset();
    current = base();
  });

  it("⭐ düğme: onaylı/kısmi + yazma izni var; yalnız okuma izni, taslak (form zaten açık) ve iptalde yok", () => {
    const { unmount } = renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.getByTestId("fis-no-duzelt")).toHaveTextContent("Fiş no / tarih düzelt");
    unmount();
    current = base({ status: "PARTIAL" });
    const r2 = renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.getByTestId("fis-no-duzelt")).toBeInTheDocument();
    r2.unmount();
    perms.delete("gelen-belge:write");
    const r3 = renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("fis-no-duzelt")).toBeNull();
    r3.unmount();
    perms.add("gelen-belge:write");
    for (const status of ["DRAFT", "CANCELLED", "APPROVING"] as const) {
      current = base({ status });
      const r = renderWithProviders(<IncomingDocumentDetailPage />);
      expect(screen.queryByTestId("fis-no-duzelt"), status).toBeNull();
      r.unmount();
    }
  });

  it("⭐ kaydet: yalnız değişen alan /kunye'ye gider, diyalog kapanır", async () => {
    patch.mockResolvedValueOnce({ data: { data: base({ senderDocNo: "A-77" }) } });
    renderWithProviders(<IncomingDocumentDetailPage />);
    await userEvent.click(screen.getByTestId("fis-no-duzelt"));
    const save = screen.getByTestId("fis-no-duzelt-save");
    expect(save).toBeDisabled(); // değişiklik yok
    await userEvent.type(screen.getByLabelText("Fiş no"), " A-77 ");
    await userEvent.click(save);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toBe("/api/gelen-belge/irsaliyeler/n1/kunye");
    expect(patch.mock.calls[0]![1]).toStrictEqual({ senderDocNo: "A-77" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("⭐ WARN 409 → mükerrer kutusu; 'Yine de kaydet' bayrakla yeniden gönderir", async () => {
    patch.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", "Aynı belge no", { senderDocNo: "A-1", peers: PEERS })).mockResolvedValueOnce({ data: { data: base() } });
    renderWithProviders(<IncomingDocumentDetailPage />);
    await userEvent.click(screen.getByTestId("fis-no-duzelt"));
    await userEvent.type(screen.getByLabelText("Fiş no"), "A-1");
    await userEvent.click(screen.getByTestId("fis-no-duzelt-save"));
    const box = await screen.findByTestId("duplicate-doc-no-confirm");
    expect(box).toHaveTextContent("Bu belge no (A-1) GB-0007 olarak zaten kayıtlı");
    await userEvent.click(within(box).getByRole("button", { name: "Yine de kaydet" }));
    expect(patch.mock.calls[1]![1]).toStrictEqual({ senderDocNo: "A-1", confirmDuplicateDocNo: true });
  });

  it("BLOCK 409 → sunucu mesajı satır içinde, kutu yok", async () => {
    patch.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO", "Bu sahip için aynı gönderen belge numarasıyla açık bir taslak/belge zaten var."));
    renderWithProviders(<IncomingDocumentDetailPage />);
    await userEvent.click(screen.getByTestId("fis-no-duzelt"));
    await userEvent.type(screen.getByLabelText("Fiş no"), "A-1");
    await userEvent.click(screen.getByTestId("fis-no-duzelt-save"));
    expect(await screen.findByTestId("fis-no-duzelt-error")).toHaveTextContent("aynı gönderen belge numarasıyla");
    expect(screen.queryByTestId("duplicate-doc-no-confirm")).toBeNull();
  });

  it("identityFixBody: değişmeyen alan konmaz; boşaltma null; tarih gün kısmıyla kıyaslanır", () => {
    const n = { id: "n1", noteNo: "GB-1", senderDocNo: "A-1", senderDocDate: "2026-11-08T00:00:00.000Z" };
    expect(identityFixBody(n, "A-1", "2026-11-08")).toBeNull();
    expect(identityFixBody(n, "  ", "2026-11-08")).toStrictEqual({ senderDocNo: null });
    expect(identityFixBody(n, "A-1", "2026-11-09")).toStrictEqual({ senderDocDate: "2026-11-09" });
    expect(identityFixBody(n, "A-1", "")).toStrictEqual({ senderDocDate: null });
  });
});
