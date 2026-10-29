// H9 inceleme bulgusu: gramaj kataloğu `fabric-properties` ucundan (property:read) OKUNMAZ; eşleme yanıtındaki
// `processOptions` (gelen-belge:read) kullanılır. property:read'siz onay yetkilisi (Muhasebe/Süpervizör şablonu) detayı
// açınca 403 uyarısı almamalı, gramaj paneli yine görünmeli.
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";

const apiGet = vi.fn((url: string) => Promise.reject(new Error(`beklenmeyen istek: ${url}`)));
vi.mock("@/services/apiClient", () => ({ default: { get: (url: string) => apiGet(url), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  // Muhasebe şablonu gibi: gelen-belge:* var, property:read / mobile:* yok.
  useRoleAccess: () => ({ hasPermission: (p: string) => p.startsWith("gelen-belge:"), isAdmin: false }),
}));
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

const empty = { rawText: null, suggested: null, source: "NONE" as const, list: [] };
const note = {
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", processText: "KURŞUN 25 GR", varianceReason: null, scans: [],
  lines: [{ id: "a", lineNo: 1, blockNo: 1, processText: null, rollId: null, status: "PENDING" }],
};
const suggestions = {
  noteId: "n1", sender: empty, owner: empty,
  process: { rawText: "KURŞUN 25 GR", suggested: { id: "v25", name: "25 gr" }, source: "PATTERN" },
  processOptions: [{ id: "v25", name: "25 gr" }, { id: "v50", name: "50 gr" }],
  lines: [],
};
const idle = { mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock("../useNoteDetail", () => ({
  useNoteDetail: () => ({ note: { data: note, isError: false }, suggestions: { data: suggestions }, header: idle, line: idle, removeLine: idle, invalidate: vi.fn() }),
}));

describe("detay sayfası — gramaj paneli yetki kapsamı", () => {
  it("property:read'siz onay yetkilisi: fabric-properties isteği YOK, panel processOptions ile çizilir", async () => {
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(await screen.findByTestId("process-gramaj")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "25 gr (öneri)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "50 gr" })).toBeInTheDocument();
    expect(apiGet.mock.calls.filter(([u]) => String(u).includes("fabric-properties"))).toEqual([]);
  });
});
