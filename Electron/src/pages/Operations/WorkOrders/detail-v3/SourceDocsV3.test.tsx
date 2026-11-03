// K28 İE detayı "Geldiği belge": GB no bağlantısı + fotoğraf aç; SİLİNDİ fotoğrafta açıklama; modül kapalıysa bölüm yok.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourceDocsV3 } from "./SourceDocsV3";
import type { WorkOrderSourceNote } from "@/pages/Operations/GelenBelgeler/photoRetentionTypes";

const flags = { on: true };
vi.mock("@/hooks/usePricingEnabled", () => ({ useGelenBelgeEnabled: () => flags.on }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/pages/Operations/GelenBelgeler/useScanImage", () => ({
  useScanImage: (id: string | null, o?: { purged?: boolean }) => ({ url: o?.purged ? null : `blob:${id}`, isLoading: false, isError: false, purged: Boolean(o?.purged), isPdf: false }),
}));
const notes: WorkOrderSourceNote[] = [
  { id: "n1", noteNo: "GB-0001", status: "APPROVED", senderDocNo: "A-1", scans: [{ id: "s1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", contentState: "REDUCED", contentStateAt: null }] },
  { id: "n2", noteNo: "GB-0002", status: "APPROVED", senderDocNo: "A-2", scans: [{ id: "s2", pageNo: 1, regionNo: null, mimeType: "image/jpeg", contentState: "PURGED", contentStateAt: null }] },
];
const getWorkOrderSourceNotes = vi.fn();
vi.mock("@/pages/Operations/GelenBelgeler/service", () => ({ INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge", getWorkOrderSourceNotes: (id: string) => getWorkOrderSourceNotes(id) }));

const view = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SourceDocsV3 workOrderId="wo1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("İE Geldiği belge (K28)", () => {
  beforeEach(() => {
    flags.on = true;
    getWorkOrderSourceNotes.mockReset().mockResolvedValue({ total: 2, notes });
  });
  it("§1 GB no bağlantısı + KÜÇÜK fotoğraf açılır", async () => {
    view();
    const link = await screen.findByRole("link", { name: "GB-0001" });
    expect(link.getAttribute("href")).toBe("/operations/gelen-belgeler/n1");
    fireEvent.click(screen.getByTestId("wo-source-doc-open"));
    expect(screen.getByRole("img", { name: "Sayfa 1" }).getAttribute("src")).toBe("blob:s1");
  });
  it("§2 SİLİNDİ fotoğraf → açıklama, açma düğmesi yok", async () => {
    view();
    expect((await screen.findByTestId("wo-source-doc-purged")).textContent).toBe("Fotoğraf saklama ayarı gereği silindi.");
    expect(screen.getAllByTestId("wo-source-doc-open")).toHaveLength(1);
  });
  it("§3 modül kapalı → istek yok, bölüm yok", () => {
    flags.on = false;
    view();
    expect(getWorkOrderSourceNotes).not.toHaveBeenCalled();
    expect(screen.queryByTestId("wo-source-docs")).toBeNull();
  });
});
