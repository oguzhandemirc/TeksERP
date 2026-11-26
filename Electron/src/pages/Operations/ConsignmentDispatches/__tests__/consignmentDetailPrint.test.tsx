// Denetim 6: emanet çıkış detayında "Belgeyi Görüntüle / Bas" — CONSIGNMENT_DISPATCH diyaloğu (kaynak = çıkış) açılır;
// iptal edilmiş çıkışta da açılır (belge İPTAL filigranıyla basılır), iptal düğmesi görünmez.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ConsignmentDispatchDto } from "../types";

vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, detail: null as (ConsignmentDispatchDto & { updatedAt: string }) | null }));
vi.mock("@/components/print/PrintedDocDialog", () => ({
  PrintedDocDialog: (p: Record<string, unknown>) => {
    seen.props = p;
    return p.open ? <div data-testid="doc-dialog" /> : null;
  },
}));
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  getConsignmentDispatch: async () => seen.detail,
}));
import { ConsignmentDispatchDetailSheet } from "../ConsignmentDispatchDetailSheet";

const base: ConsignmentDispatchDto & { updatedAt: string } = {
  id: "d1",
  dispatchNo: "EC2611260001",
  ownerCustomer: { id: "c1", code: "MUS-1", name: "Örnek Tekstil" },
  dispatchedAt: "2026-11-26T09:00:00.000Z",
  dispatchedBy: null,
  plateNumber: null,
  driverName: null,
  notes: null,
  cancelledAt: null,
  cancelReason: null,
  items: [],
  totals: { beamCount: 0, beamLengthM: "0.000", yarnKg: "0.000" },
  updatedAt: "2026-11-26T09:00:00.000Z",
};

describe("Emanet çıkış detayı — basılı belge", () => {
  beforeEach(() => {
    seen.props = null;
  });

  it("düğme CONSIGNMENT_DISPATCH diyaloğunu çıkış kaynağıyla açar", async () => {
    seen.detail = base;
    renderWithProviders(<ConsignmentDispatchDetailSheet dispatchId="d1" onClose={() => {}} onCancel={() => {}} />);
    const btn = await screen.findByRole("button", { name: /Belgeyi Görüntüle \/ Bas/ });
    expect(screen.queryByTestId("doc-dialog")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("doc-dialog")).toBeInTheDocument());
    expect(seen.props).toMatchObject({ docType: "CONSIGNMENT_DISPATCH", sourceId: "d1", writePermission: "consignment:write", open: true });
    expect(String(seen.props?.title)).toContain("EC2611260001");
  });

  it("iptal edilmiş çıkışta belge yine açılır, iptal düğmesi yoktur", async () => {
    seen.detail = { ...base, cancelledAt: "2026-11-26T10:00:00.000Z", cancelReason: "Yanlış lot" };
    renderWithProviders(<ConsignmentDispatchDetailSheet dispatchId="d1" onClose={() => {}} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Belgeyi Görüntüle \/ Bas/ }));
    await waitFor(() => expect(screen.getByTestId("doc-dialog")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /İptal Et/ })).toBeNull();
  });
});
