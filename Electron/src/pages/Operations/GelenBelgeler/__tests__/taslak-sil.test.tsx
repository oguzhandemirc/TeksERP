// Prova-2: taslak gelen belge panelden silinir — "Sil" yalnız DRAFT'ta görünür, onay diyaloğu, mevcut DELETE ucu.
// Negatif sonda: detay sayfasındaki `note.status === "DRAFT"` kapısı + bileşen içi süzme kaldırılınca §2 kırmızı.
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";

const apiDelete = vi.fn((_url: string) => Promise.resolve({ data: { data: { id: "n1", noteNo: "GB-0001" } } }));
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(() => Promise.reject(new Error("beklenmeyen"))), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: (url: string) => apiDelete(url) },
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
  beforeEach(() => apiDelete.mockClear());

  it("§1 DRAFT: Sil → onay diyaloğu (numara yeniden verilmez) → DELETE /irsaliyeler/:id", async () => {
    state.status = "DRAFT";
    renderWithProviders(<IncomingDocumentDetailPage />);
    fireEvent.click(screen.getByTestId("note-delete-draft"));
    expect(await screen.findByText("GB-0001 taslağı silinsin mi?")).toBeInTheDocument();
    expect(screen.getByText(/GB-0001 numarası yeniden verilmez/)).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    expect(apiDelete).toHaveBeenCalledWith(expect.stringMatching(/\/irsaliyeler\/n1$/));
  });

  it.each(["APPROVING", "APPROVED", "PARTIAL", "CANCELLED"])("§2 %s: Sil düğmesi YOK", (status) => {
    state.status = status;
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(screen.queryByTestId("note-delete-draft")).toBeNull();
  });
});
