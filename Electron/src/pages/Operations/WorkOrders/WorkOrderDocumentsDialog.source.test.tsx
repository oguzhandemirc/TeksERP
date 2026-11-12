// "Geldiği belge" İE sayfasından "Belgeler" modalının başına taşındı (2026-11-10): modalda görünür, belgesiz İE'de
// çizilmez, sayfada ayrı bölüm yok; GB bağlantısına tıklanınca modal kapanır.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import pageSource from "./WorkOrderDetailPage.tsx?raw";

vi.mock("@/hooks/usePricingEnabled", () => ({ useGelenBelgeEnabled: () => true }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/pages/Operations/GelenBelgeler/useScanImage", () => ({
  useScanImage: (id: string) => ({ url: `blob:${id}`, isLoading: false, isError: false, purged: false, isPdf: false }),
}));
const getWorkOrderSourceNotes = vi.fn();
vi.mock("@/pages/Operations/GelenBelgeler/service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getWorkOrderSourceNotes: (id: string) => getWorkOrderSourceNotes(id),
}));
vi.mock("./service", () => ({ workOrderService: { getDocuments: () => Promise.resolve({ data: { documents: [] } }) } }));
vi.mock("@/components/print/PrintedDocDialog", () => ({ PrintedDocDialog: () => null }));

const note = (id: string, noteNo: string) => ({
  id, noteNo, status: "APPROVED", senderDocNo: `S-${id}`,
  scans: [{ id: `s-${id}`, pageNo: 1, regionNo: null, mimeType: "image/jpeg", contentState: "REDUCED", contentStateAt: null }],
});

const view = (onOpenChange = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <WorkOrderDocumentsDialog open onOpenChange={onOpenChange} workOrderId="wo1" onPrintTravelerCard={vi.fn()} onPrintDispatch={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onOpenChange;
};

describe("Belgeler modalı — Geldiği belge", () => {
  beforeEach(() => getWorkOrderSourceNotes.mockReset());

  it("§1 birden çok gelen belge modalda listelenir (GB bağlantısı, belge no, durum, Fotoğrafı aç)", async () => {
    getWorkOrderSourceNotes.mockResolvedValue({ total: 2, notes: [note("n1", "GB-1"), note("n2", "GB-2")] });
    const onOpenChange = view();
    expect(await screen.findByText("Geldiği belge")).toBeTruthy();
    expect(screen.getAllByTestId("wo-source-doc")).toHaveLength(2);
    expect(screen.getByText("Belge no: S-n1")).toBeTruthy();
    expect(screen.getAllByText("Onaylandı").length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByTestId("wo-source-doc-open")[0] as HTMLElement);
    expect(screen.getByRole("img", { name: "Sayfa 1" }).getAttribute("src")).toBe("blob:s-n1");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("link", { name: "GB-2" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("§2 gelen belgesi olmayan İE → bölüm çizilmez", async () => {
    getWorkOrderSourceNotes.mockResolvedValue({ total: 0, notes: [] });
    view();
    expect(await screen.findByText(/ait belge yok/)).toBeTruthy();
    expect(screen.queryByText("Geldiği belge")).toBeNull();
    expect(screen.queryByTestId("wo-source-docs-section")).toBeNull();
  });

  it("§3 İE detay sayfasında ayrı Geldiği belge bölümü yok", () => {
    expect(pageSource).not.toMatch(/SourceDocsV3/);
  });
});
