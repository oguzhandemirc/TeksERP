// Prova-2: "Taslağı iptal et" yalnız DRAFT'ta görünür; onay diyaloğu sunucu önizlemesinden satır + parti sayısını yazar,
// onay mevcut DELETE ucunu çağırır. Negatif sonda: `note.status === "DRAFT"` kapısı kaldırılınca §2 kırmızı;
// açıklamada parti dalı kaldırılınca §1 kırmızı; `confirmDisabled` önizleme engeli kaldırılınca §3 kırmızı (2026-11-06).
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";

const apiDelete = vi.fn((_url: string) => Promise.resolve({ data: { data: { id: "n1", noteNo: "GB-0001" } } }));
const preview = { deletable: true, reason: null as string | null };
const apiPost = vi.fn((_url: string, _body: unknown) =>
  Promise.resolve({
    data: {
      data: {
        items: [{ id: "n1", noteNo: "GB-0001", status: "DRAFT", deletable: preview.deletable, code: preview.deletable ? null : "DELIVERY_NOTE_NOT_DRAFT", reason: preview.reason, lineCount: 7, partyCount: 2, scanCount: 1, ownerName: null, senderName: null, senderDocNo: null }],
        summary: { requested: 1, deletable: 1, blocked: 0, lines: 7, scans: 1 },
      },
    },
  }),
);
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), post: (url: string, body: unknown) => apiPost(url, body), put: vi.fn(), patch: vi.fn(), delete: (url: string) => apiDelete(url) },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => p.startsWith("gelen-belge:"), isAdmin: false }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../ScanViewer", () => ({ ScanViewer: () => null }));
vi.mock("../NoteHeaderForm", () => ({ NoteHeaderForm: () => null }));
vi.mock("../TotalsStrip", () => ({ TotalsStrip: () => null }));
vi.mock("../LinesTable", () => ({ LinesTable: () => null }));
vi.mock("../AddLineForm", () => ({ AddLineForm: () => null }));
vi.mock("../LineImportButton", () => ({ LineImportButton: () => null }));
vi.mock("../CellReviewDialog", () => ({ CellReviewDialog: () => null }));
vi.mock("../ApproveDialog", () => ({ ApproveDialog: () => null }));
vi.mock("../ScanReadBanner", () => ({ ScanReadBanner: () => null }));
vi.mock("../AddPagesAction", () => ({ AddPagesAction: () => null }));
vi.mock("../ProcessGramajPanel", () => ({ ProcessGramajPanel: () => null }));

const state = { status: "DRAFT" };
const idle = { mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock("../useNoteDetail", () => ({
  useNoteDetail: () => ({
    note: { data: { id: "n1", noteNo: "GB-0001", status: state.status, sourceKind: "OCR", processText: null, varianceReason: null, scans: [{ id: "s1" }], lines: [] }, isError: false },
    suggestions: { data: undefined }, header: idle, line: idle, removeLine: idle, invalidate: vi.fn(),
  }),
}));

describe("gelen belge taslağı silme (prova-2)", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    apiPost.mockClear();
    preview.deletable = true;
    preview.reason = null;
  });

  it("§1 DRAFT: Taslağı iptal et → onay (satır + parti önizlemeden, numara yeniden verilmez) → DELETE /irsaliyeler/:id", async () => {
    state.status = "DRAFT";
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.getByTestId("note-delete-draft")).toHaveTextContent("Taslağı iptal et");
    fireEvent.click(screen.getByTestId("note-delete-draft"));
    expect(await screen.findByText("GB-0001 taslağı iptal edilsin mi?")).toBeInTheDocument();
    expect(await screen.findByText(/7 satır · 2 parti/)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(expect.stringMatching(/toplu-sil\/onizleme$/), { ids: ["n1"] });
    expect(screen.getByText(/GB-0001 numarası yeniden verilmez/)).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Taslağı iptal et" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    expect(apiDelete).toHaveBeenCalledWith(expect.stringMatching(/\/irsaliyeler\/n1$/));
  });

  it("§3 önizleme silinemez derse (bu arada onaylandı) neden yazılır, onay kapalı", async () => {
    state.status = "DRAFT";
    preview.deletable = false;
    preview.reason = "Onaylanmış belge silinemez.";
    renderWithProviders(<IncomingDocumentDetailPage />);
    fireEvent.click(screen.getByTestId("note-delete-draft"));
    expect(await screen.findByText(/Onaylanmış belge silinemez/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Taslağı iptal et" })).toBeDisabled();
  });

  it.each(["APPROVING", "APPROVED", "PARTIAL", "CANCELLED"])("§2 %s: iptal düğmesi YOK", (status) => {
    state.status = status;
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("note-delete-draft")).toBeNull();
  });
});
