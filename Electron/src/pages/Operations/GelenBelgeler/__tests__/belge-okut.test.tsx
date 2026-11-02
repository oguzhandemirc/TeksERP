// P3 "Belge okut" saf parçaları + formdaki düğme (eski ayrı onay kartı K6'da kalktı; belgeden form `oie/__tests__`).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { belgeOkutStage } from "../belgeOkut";
import { BelgeOkutButton, BELGE_OKUT_NO_ROUTE } from "@/pages/Operations/WorkOrders/BelgeOkutButton";

const getNote = vi.fn();
const approveNote = vi.fn();
const patchHeader = vi.fn();
const settings = { entryMode: "PER_DOCUMENT", unreviewedApproval: "WARN" };
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getDeliveryNote: () => getNote(),
  getSuggestions: () => Promise.resolve({ noteId: "n1", owner: { rawText: null, suggested: null, source: "NONE", list: [] }, sender: { rawText: null, suggested: null, source: "NONE", list: [] }, lines: [] }),
  getIncomingDocumentSettings: () => Promise.resolve(settings),
  approveNote: (...a: unknown[]) => approveNote(...a),
  updateNoteHeader: (...a: unknown[]) => patchHeader(...a),
  requeueScan: vi.fn(),
  addLines: vi.fn(),
  updateLine: vi.fn(),
  deleteLine: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
}));
const perms = { list: ["gelen-belge:write", "gelen-belge:approve"] };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)) }),
}));
const flags = { gelenBelge: true };
vi.mock("@/hooks/usePricingEnabled", () => ({ useGelenBelgeEnabled: () => flags.gelenBelge }));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: ({ value }: { value: string | null }) => <span data-testid="owner-value">{value ?? "yok"}</span> }));
vi.mock("@/pages/Routes/service", () => ({ routeService: { getById: () => Promise.resolve({ data: { id: "rt1", name: "Kurşun → Tambur" } }) } }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

const scan = (status: string, mimeType = "image/jpeg") => ({ id: `s-${status}`, pageNo: 1, regionNo: null, status, mimeType, attempts: 1 });
const note = (over: Record<string, unknown> = {}) => ({
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "MANUAL", ownerCustomerId: "c1",
  kursunMeters: "4521", kursunMetersSource: "OUTPUT", kursunMetersReview: false, ourBatchNo: "214279",
  scans: [scan("READ")], lines: [], ...over,
});

beforeEach(() => {
  getNote.mockReset();
  approveNote.mockReset();
  patchHeader.mockReset();
  perms.list = ["gelen-belge:write", "gelen-belge:approve"];
  flags.gelenBelge = true;
  settings.entryMode = "PER_DOCUMENT";
});

describe("belgeOkutStage (saf)", () => {
  it("⭐ okuyucusuz kurulumda bekleyen sayfa NO_SERVICE (sonsuz okunuyor yok); alan yoksa bugünkü READING", () => {
    expect(belgeOkutStage({ ...note({ scans: [scan("PENDING")] }), readerConfigured: false })).toBe("NO_SERVICE");
    expect(belgeOkutStage({ ...note({ scans: [scan("PENDING")] }), readerConfigured: true })).toBe("READING");
    expect(belgeOkutStage(note({ scans: [scan("PENDING")] }))).toBe("READING");
  });
  it("okunurken READING, hepsi düştüyse READ_FAILED, PDF okuma beklemez, taslak değilse CLOSED", () => {
    expect(belgeOkutStage(note({ scans: [scan("READ"), scan("READING")] }))).toBe("READING");
    expect(belgeOkutStage(note({ scans: [scan("READ_FAILED")] }))).toBe("READ_FAILED");
    expect(belgeOkutStage(note({ scans: [scan("PENDING", "application/pdf")] }))).toBe("READY");
    expect(belgeOkutStage(note({ status: "APPROVED" }))).toBe("CLOSED");
  });
});


describe("BelgeOkutButton (iş emri formu)", () => {
  it("rota seçilmeden pasif + neden", () => {
    renderWithProviders(<BelgeOkutButton routeTemplateId={null} />);
    const b = screen.getByTestId("wo-belge-okut");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", BELGE_OKUT_NO_ROUTE);
  });
  it("rota seçiliyse etkin", () => {
    renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.getByTestId("wo-belge-okut")).toBeEnabled();
  });
  it("gelen belge modülü kapalı ya da yazma izni yoksa çizilmez", () => {
    flags.gelenBelge = false;
    const { unmount } = renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.queryByTestId("wo-belge-okut")).toBeNull();
    unmount();
    flags.gelenBelge = true;
    perms.list = [];
    renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.queryByTestId("wo-belge-okut")).toBeNull();
  });
});
