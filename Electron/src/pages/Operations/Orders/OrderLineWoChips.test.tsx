import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { WorkOrderStatus } from "@/types/enums";
import { OrderLineWoChips } from "./OrderLineWoChips";
import type { OrderLine } from "./types";

/** workOrderLinks üretici. */
function links(...statuses: Array<[string, WorkOrderStatus]>): OrderLine["workOrderLinks"] {
  return statuses.map(([id, status]) => ({
    workOrderId: id,
    workOrder: { id, workOrderNumber: `IE-${id}`, status },
  }));
}

describe("OrderLineWoChips", () => {
  it("bağ yoksa null döner", () => {
    const { container } = renderWithProviders(<OrderLineWoChips links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("undefined links → null", () => {
    const { container } = renderWithProviders(<OrderLineWoChips links={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("İE no + Türkçe durum etiketi basar", () => {
    renderWithProviders(<OrderLineWoChips links={links(["a", "IN_PROGRESS"], ["b", "PLANNED"])} />);
    expect(screen.getByText("IE-a")).toBeInTheDocument();
    expect(screen.getByText("IE-b")).toBeInTheDocument();
    expect(screen.getByText("Devam Ediyor")).toBeInTheDocument();
    expect(screen.getByText("Planlandı")).toBeInTheDocument();
  });

  it("CANCELLED bağ gizlenir", () => {
    renderWithProviders(<OrderLineWoChips links={links(["a", "PLANNED"], ["b", "CANCELLED"])} />);
    expect(screen.getByText("IE-a")).toBeInTheDocument();
    expect(screen.queryByText("IE-b")).not.toBeInTheDocument();
  });

  it("yalnız CANCELLED → null döner", () => {
    const { container } = renderWithProviders(
      <OrderLineWoChips links={links(["a", "CANCELLED"])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("SUPERSEDED 'Devredildi' izi görünür", () => {
    renderWithProviders(<OrderLineWoChips links={links(["a", "SUPERSEDED"])} />);
    expect(screen.getByText("Devredildi")).toBeInTheDocument();
  });

  it("tıklanabilir öğe yok (salt bilgi)", () => {
    renderWithProviders(<OrderLineWoChips links={links(["a", "PLANNED"])} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
