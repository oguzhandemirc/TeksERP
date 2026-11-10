// İE yan paneli eylemleri: üç üst düzey düğme (Detayı Aç · Düzenle ▾ · Diğer ▾); görünürlük `header-actions.ts`ten.
// Baskı geçmişi başlık bağlantısı değil Diğer menüsünde; İptal Et kırmızı ve mevcut iptal diyaloğunu açar.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { Null, perms, openTarget } = vi.hoisted(() => ({
  Null: () => null,
  perms: { list: [] as string[] },
  openTarget: vi.fn(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ permissions: perms.list, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useOpenTarget: () => openTarget }));
vi.mock("@/lib/kursun-gramaj", () => ({ useKursunGramajCatalog: () => ({ catalog: { propertyId: null } }) }));
vi.mock("./service", () => ({ workOrderService: { getById: () => new Promise(() => {}) } }));
vi.mock("./detail-v3/SheetKpis", () => ({ SheetKpis: Null }));
vi.mock("./detail-v3/KunyeCard", () => ({ KunyeCard: Null }));
vi.mock("./detail-v3/RouteStepline", () => ({ RouteStepline: Null }));
vi.mock("./detail-v3/ProducedV3", () => ({ ProducedV3: Null }));
vi.mock("./detail-v3/OrderLinksV3", () => ({ OrderLinksV3: Null }));
vi.mock("./detail-v3/VariantTargetsSection", () => ({ VariantTargetsSection: Null }));
vi.mock("./detail-v3/ProcessSummaryCard", () => ({ ProcessSummaryCard: Null }));
vi.mock("./WorkOrderEventsSheet", () => ({ WorkOrderEventsSheet: Null }));
vi.mock("./WorkOrderDocumentsDialog", () => ({ WorkOrderDocumentsDialog: Null }));
vi.mock("./TravelerCardPrintDialog", () => ({ TravelerCardPrintDialog: Null }));
vi.mock("./FasonSevkPrintDialog", () => ({ FasonSevkPrintDialog: Null }));
vi.mock("./WorkOrderCompleteDialog", () => ({ WorkOrderCompleteDialog: Null }));
vi.mock("./LinkOrderDialog", () => ({ LinkOrderDialog: Null }));
vi.mock("./ChangeTargetDialog", () => ({ ChangeTargetDialog: Null }));
vi.mock("./FasonReceiveDialog", () => ({ FasonReceiveDialog: Null }));
vi.mock("./AddBatchDialog", () => ({ AddBatchDialog: Null }));
vi.mock("./UnlinkOrderDialog", () => ({ UnlinkOrderDialog: Null }));
// Başlığa geri konursa §1 ölçsün diye işaretli kopya (Router istemesin).
vi.mock("@/components/print/PrintHistoryLink", () => ({ PrintHistoryLink: () => <a data-testid="print-history-link" /> }));
vi.mock("./WorkOrderCancelDialog", () => ({
  WorkOrderCancelDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="cancel-dialog" /> : null),
}));

import { WorkOrderDetailSheet } from "./WorkOrderDetailSheet";
import { UNLINK_ORDER_PERMISSIONS } from "./unlink-order";
import { printHistoryHref } from "@/lib/print-history-query";
import type { WorkOrder } from "./types";

const WO_ID = "11111111-1111-4111-8111-111111111111";
const mkWo = (status: string, links = 0) =>
  ({
    id: WO_ID, workOrderNumber: "IE1", status, type: "STOCK_PRODUCTION", targetItemId: null, targetColorId: null,
    steps: [], orderLinks: Array.from({ length: links }, (_, i) => ({ orderLineId: `l${i}` })),
  }) as unknown as WorkOrder;

function renderSheet(wo: WorkOrder, opts: { perms: string[]; onEdit?: (w: WorkOrder) => void; onOpenChange?: (o: boolean) => void }) {
  perms.list = opts.perms;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkOrderDetailSheet workOrder={wo} open onOpenChange={opts.onOpenChange ?? (() => {})} onEdit={opts.onEdit} />
    </QueryClientProvider>,
  );
  return document.querySelector(".sheet-actions") as HTMLElement;
}

async function openMenu(testId: string) {
  screen.getByTestId(testId).focus();
  await userEvent.keyboard("{Enter}");
  return (await screen.findAllByRole("menuitem")).map((i) => i.textContent?.trim());
}

const FULL = ["workorder:write", "system:print-history", ...UNLINK_ORDER_PERMISSIONS];

describe("WorkOrderDetailSheet eylemleri", () => {
  it("§1 tam yetki + üretimde: TAM 3 üst düzey düğme; Düzenle menüsü ve ⚠ işareti", async () => {
    const bar = renderSheet(mkWo("IN_PROGRESS", 1), { perms: FULL, onEdit: () => {} });
    const top = within(bar).getAllByRole("button");
    expect(top.map((b) => b.textContent?.trim())).toEqual(["Detayı Aç", "Düzenle⚠", "Diğer"]);
    expect(screen.queryByTestId("print-history-link")).toBeNull();
    expect(await openMenu("wo-actions-duzenle")).toEqual([
      "Düzenle⚠", "Sipariş Bağla", "Sipariş Bağını Kopar", "Rengi Değiştir", "Eni Değiştir", "Parti Ekle",
    ]);
  });

  it("§2 Diğer menüsü: kayıtlar, Baskı geçmişi, ayırıcı, Kapat, İptal Et (kırmızı) → iptal diyaloğu", async () => {
    renderSheet(mkWo("IN_PROGRESS"), { perms: FULL, onEdit: () => {} });
    expect(await openMenu("wo-actions-diger")).toEqual([
      "Fason Kabul", "Belgeler", "Hareketler", "Baskı geçmişi", "Kapat", "İptal Et",
    ]);
    // Ayırıcı Kapat'tan ÖNCE: durum geçişleri (Kapat + İptal) kayıtlardan ayrı blokta.
    const order = Array.from(screen.getByRole("menu").children).map((el) =>
      el.getAttribute("role") === "separator" ? "—" : el.textContent?.trim(),
    );
    expect(order).toEqual(["Fason Kabul", "Belgeler", "Hareketler", "Baskı geçmişi", "—", "Kapat", "İptal Et"]);
    const cancel = screen.getByTestId("wo-action-cancel");
    expect(cancel.className).toContain("text-destructive");
    expect(screen.queryByTestId("cancel-dialog")).toBeNull();
    await userEvent.click(cancel);
    expect(screen.getByTestId("cancel-dialog")).toBeTruthy();
  });

  it("§3 Baskı geçmişi menüden kaydın baskılarını açar ve paneli kapatır", async () => {
    openTarget.mockClear();
    const onOpenChange = vi.fn();
    renderSheet(mkWo("PLANNED"), { perms: FULL, onEdit: () => {}, onOpenChange });
    await openMenu("wo-actions-diger");
    await userEvent.click(screen.getByTestId("wo-action-printHistory"));
    expect(openTarget).toHaveBeenCalledWith(printHistoryHref(WO_ID));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("§4 üretimdeyken Düzenle önce onay ister", async () => {
    const onEdit = vi.fn();
    renderSheet(mkWo("IN_PROGRESS"), { perms: FULL, onEdit });
    await openMenu("wo-actions-duzenle");
    await userEvent.click(screen.getByTestId("wo-action-edit"));
    expect(onEdit).not.toHaveBeenCalled();
    expect(await screen.findByText("Üretim devam ediyor")).toBeTruthy();
  });

  it("§5 yazma/baskı izni yok + kapanmış: Düzenle menüsü çizilmez; Diğer yalnız kayıtlar", async () => {
    const bar = renderSheet(mkWo("COMPLETED"), { perms: ["workorder:read"], onEdit: () => {} });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Detayı Aç", "Diğer"]);
    expect(await openMenu("wo-actions-diger")).toEqual(["Belgeler", "Hareketler"]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("§6 düzenleme yolu verilmezse (onEdit yok) Düzenle öğesi ve ⚠ işareti yok", async () => {
    const bar = renderSheet(mkWo("IN_PROGRESS"), { perms: FULL });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Detayı Aç", "Düzenle", "Diğer"]);
    const items = await openMenu("wo-actions-duzenle");
    expect(items).not.toContain("Düzenle");
    expect(items[0]).toBe("Sipariş Bağla");
  });
});
