// Sipariş detayı "Müşteride:" renk adı SUNUCUDAN gelir (`resolvedCustomerColorName`, kumaşa özel ad dahil):
// yeni backend'de istemci genel ad haritası (colorAliasMap) HİÇ istenmez; alanı göndermeyen eski backend'de yedektir.
// Negatif sonda (kırmızı görüldü): genel ad sorgusu yeni backend'de de açılınca (`enabled: canRead`) ilk iki vaka ❌.
// Sunucunun "bizdeki ad" kararı (null) önbellekteki genel ad haritasıyla ezilmez. Negatif sonda (kırmızı görüldü):
// `server.resolvedCustomerColorName ?? legacyColor.get(...)` biçimine çevrilince o vaka ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { customerAliasService } from "@/pages/Customers/aliasService";
import { orderService } from "./service";
import { OrderDetailSheet } from "./OrderDetailSheet";
import type { Order, OrderLine } from "./types";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("@/pages/Customers/aliasService", () => ({
  customerAliasService: { listItemAliases: vi.fn(), listColorAliases: vi.fn() },
}));
vi.mock("./service", () => ({ orderService: { getById: vi.fn(), manualClose: vi.fn() } }));
vi.mock("@/pages/Operations/Returns/service", () => ({ returnsService: { summaryForOrder: vi.fn(() => new Promise(() => {})) } }));
// Ağır alt kartların kendi bekçileri var; burada yalnız kalem adı ölçülür.
vi.mock("@/pages/Operations/WorkOrders/CoveragePanel", () => ({ CoveragePanel: () => null }));
vi.mock("./OrderShipmentsCard", () => ({ OrderShipmentsCard: () => null }));
vi.mock("./LinkedWorkOrdersCard", () => ({ LinkedWorkOrdersCard: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));

const svc = vi.mocked(customerAliasService);
const orders = vi.mocked(orderService);

const LINE: OrderLine = {
  id: "l1",
  itemId: "x",
  colorId: "ekru",
  quantity: 100,
  shippedQty: 0,
  unit: "MT",
  width: null,
  unitPrice: null,
  customerItemName: null,
  customerColorName: null,
  cutNote: null,
  cancelledAt: null,
  item: { id: "x", code: "X", name: "X Kumaş" },
  color: { id: "ekru", code: "R01", name: "Ekru", hex: null },
} as unknown as OrderLine;

const order = (lines: OrderLine[]): Order =>
  ({ id: "o1", orderNumber: "SIP-1", status: "APPROVED", shippedQty: 0, customerId: "c1", customer: { id: "c1", name: "A" }, lines, createdAt: "", updatedAt: "" }) as unknown as Order;

beforeEach(() => {
  vi.clearAllMocks();
  perms = ["customer-alias:read"];
  svc.listItemAliases.mockResolvedValue({ success: true, data: [] });
  svc.listColorAliases.mockResolvedValue({ success: true, data: [{ id: "g", customerId: "c1", colorId: "ekru", alias: "KREM", assigned: false }] });
});

describe("OrderDetailSheet — müşteri renk adı", () => {
  it("yeni backend: ad detay ucundan gelir, genel ad listesi istenmez", async () => {
    orders.getById.mockResolvedValue({ success: true, data: order([{ ...LINE, resolvedCustomerColorName: "ABC", colorNameScope: "ITEM" }]) });
    renderWithProviders(<OrderDetailSheet order={order([LINE])} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Müşteride:\s*ABC/)).toBeInTheDocument();
    expect(orders.getById).toHaveBeenCalledWith("o1");
    expect(svc.listColorAliases).not.toHaveBeenCalled();
  });

  it("çözülmüş adı taşıyan kayıt verilirse ek istek atılmaz", async () => {
    renderWithProviders(<OrderDetailSheet order={order([{ ...LINE, resolvedCustomerColorName: "ABC", colorNameScope: "ITEM" }])} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Müşteride:\s*ABC/)).toBeInTheDocument();
    expect(orders.getById).not.toHaveBeenCalled();
    expect(svc.listColorAliases).not.toHaveBeenCalled();
  });

  it("yeni backend null (bizdeki ad) dönerse önbellekteki genel ad basılmaz", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Aynı carinin genel ad haritası başka bir ekrandan önbellekte duruyor olabilir.
    qc.setQueryData(["customer", "c1", "color-aliases"], { success: true, data: [{ id: "g", customerId: "c1", colorId: "ekru", alias: "KREM", assigned: false }] });
    orders.getById.mockResolvedValue({ success: true, data: order([{ ...LINE, resolvedCustomerColorName: null, colorNameScope: null }]) });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <OrderDetailSheet order={order([LINE])} open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(qc.getQueryState(["orders", "detail", "o1"])?.status).toBe("success"));
    await waitFor(() => expect(screen.getByText("X Kumaş")).toBeInTheDocument());
    expect(screen.queryByText(/Müşteride:/)).toBeNull();
    expect(svc.listColorAliases).not.toHaveBeenCalled();
  });

  it("eski backend (alan yok): genel ad haritası yedek olarak kullanılır", async () => {
    orders.getById.mockResolvedValue({ success: true, data: order([LINE]) });
    renderWithProviders(<OrderDetailSheet order={order([LINE])} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Müşteride:\s*KREM/)).toBeInTheDocument();
    expect(svc.listColorAliases).toHaveBeenCalledWith("c1");
  });

  it("okuma izni yoksa yalnız satır adı — ana veri istenmez", async () => {
    perms = [];
    renderWithProviders(<OrderDetailSheet order={order([{ ...LINE, customerColorName: "SATIR" }])} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Müşteride:\s*SATIR/)).toBeInTheDocument();
    await waitFor(() => expect(orders.getById).not.toHaveBeenCalled());
    expect(svc.listColorAliases).not.toHaveBeenCalled();
  });
});
