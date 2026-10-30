// D4-D2c: İE detayında desen hedefi + müşteri partisi — kurşun kataloğundan bağımsız; veri yoksa bölüm gizli.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
let perms = ["workorder:read"];
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));

import { VariantTargetsSection } from "./VariantTargetsSection";

const kursun = { target: null, rows: [], totals: { rollCount: 0, meters: "0" } };
const reply = (data: object) => get.mockResolvedValue({ data: { success: true, data: { kursun, ...data } } });

describe("VariantTargetsSection", () => {
  beforeEach(() => {
    get.mockReset();
    perms = ["workorder:read"];
  });
  it("desen hedefi ve müşteri partisi görünür", async () => {
    reply({
      variantTargets: [{ propertyId: "pB", propertyName: "Brode deseni", valueId: "d12", valueName: "Desen D12" }],
      deliveryNoteGramaj: {
        suggested: null, rollCount: 3, coveredRollCount: 3, entries: [],
        customerBatches: [{ key: "k1", ownerCustomerId: "c1", ownerName: "Acme Perde", batchNo: "P-77", rollCount: 3 }],
      },
    });
    renderWithProviders(<VariantTargetsSection workOrderId="wo1" />);
    expect(await screen.findByText("Desen D12")).toBeInTheDocument();
    expect(screen.getByText("Brode deseni hedefi:")).toBeInTheDocument();
    expect(screen.getByTestId("customer-batches")).toHaveTextContent("P-77");
    expect(screen.getByTestId("customer-batches")).toHaveTextContent("Acme Perde");
    expect(screen.getByTestId("customer-batches")).toHaveTextContent("3 top");
    expect(get).toHaveBeenCalledWith("/api/work-orders/wo1/process-summary");
  });
  it("yalnız müşteri partisi varsa desen satırı yok", async () => {
    reply({ deliveryNoteGramaj: { suggested: null, rollCount: 1, coveredRollCount: 1, entries: [], customerBatches: [{ key: "k", ownerCustomerId: "c", ownerName: "X", batchNo: "B1", rollCount: 1 }] } });
    renderWithProviders(<VariantTargetsSection workOrderId="wo1" />);
    expect(await screen.findByText("B1")).toBeInTheDocument();
    expect(screen.queryByTestId("variant-targets")).toBeNull();
  });
  it("veri yoksa (eski backend / gelen belgesiz İE) bölüm gizli", async () => {
    reply({ deliveryNoteGramaj: null });
    renderWithProviders(<VariantTargetsSection workOrderId="wo1" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("variant-targets-section")).toBeNull();
    expect(screen.queryByText("Desen Hedefi ve Müşteri Partisi")).toBeNull();
  });
  it("workorder:read yoksa sorgu atılmaz", () => {
    perms = [];
    renderWithProviders(<VariantTargetsSection workOrderId="wo1" />);
    expect(get).not.toHaveBeenCalled();
  });
});
