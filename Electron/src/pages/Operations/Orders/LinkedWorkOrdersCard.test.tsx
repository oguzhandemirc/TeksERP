import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { WorkOrderStatus } from "@/types/enums";

const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({
  useOpenTarget: () => openTarget,
}));

import { LinkedWorkOrdersCard } from "./LinkedWorkOrdersCard";
import type { OrderLine } from "./types";

/** Yalnız workOrderLinks taşıyan minimal kalem (kart yalnız bunu okur). */
function line(links: Array<{ id: string; status: WorkOrderStatus }>): OrderLine {
  return {
    workOrderLinks: links.map((l) => ({
      workOrderId: l.id,
      workOrder: { id: l.id, workOrderNumber: `IE-${l.id}`, status: l.status },
    })),
  } as unknown as OrderLine;
}

describe("LinkedWorkOrdersCard", () => {
  beforeEach(() => {
    openTarget.mockReset();
  });

  it("bağ yoksa null döner (kart görünmez)", () => {
    const { container } = renderWithProviders(<LinkedWorkOrdersCard lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("distinct İE'leri no + Türkçe durum etiketiyle listeler", () => {
    const lines = [
      line([
        { id: "wo1", status: "IN_PROGRESS" },
        { id: "wo2", status: "COMPLETED" },
      ]),
      line([{ id: "wo1", status: "IN_PROGRESS" }]), // tekrar → distinct
    ];
    renderWithProviders(<LinkedWorkOrdersCard lines={lines} />);
    expect(screen.getByText(/Bağlı İş Emirleri \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("IE-wo1")).toBeInTheDocument();
    expect(screen.getByText("IE-wo2")).toBeInTheDocument();
    expect(screen.getByText("Devam Ediyor")).toBeInTheDocument();
    expect(screen.getByText("Tamamlandı")).toBeInTheDocument();
    // distinct WO başına tek satır (buton)
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("SUPERSEDED 'Devredildi' izi olarak görünür", () => {
    renderWithProviders(
      <LinkedWorkOrdersCard lines={[line([{ id: "wo9", status: "SUPERSEDED" }])]} />,
    );
    expect(screen.getByText("Devredildi")).toBeInTheDocument();
  });

  it("tıkta openTarget(/operations/work-orders/<id>) + onNavigate çağrılır", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderWithProviders(
      <LinkedWorkOrdersCard
        lines={[line([{ id: "wo1", status: "PLANNED" }])]}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(openTarget).toHaveBeenCalledTimes(1);
    expect(openTarget.mock.calls[0]?.[0]).toBe("/operations/work-orders/wo1");
  });
});
