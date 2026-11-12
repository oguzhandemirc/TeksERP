import { describe, it, expect } from "vitest";
import { cariDocLabel, cariDocStatus, cariDocumentsCount, type CariDocumentsPage } from "./cari-documents";
import { cariTabGates, visibleCariTabs } from "./cari-record-tabs";
import type { CariSourceKey } from "./cari-sources";

const page = (total: number, types: CariDocumentsPage["types"]): CariDocumentsPage => ({
  data: [],
  pagination: { page: 1, pageSize: 25, total, totalPages: Math.ceil(total / 25) },
  types,
});
const closed = {} as Record<CariSourceKey, boolean>;
const roles = { isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: false };

describe("cari belgeler sekmesi", () => {
  it("görünen tür yoksa ya da satır yoksa sekme çizilmez; satır varsa görünür", () => {
    const gates = cariTabGates({ roles, access: closed, hasAccount: false, subcontractorId: null });
    const keys = (n: number | undefined) => visibleCariTabs(gates, { belgeler: n }).map((t) => t.key);
    expect(cariDocumentsCount(page(4, []))).toBe(0);
    expect(cariDocumentsCount(page(0, ["SHIPMENT_DISPATCH"]))).toBe(0);
    expect(cariDocumentsCount(undefined)).toBeUndefined();
    expect(keys(cariDocumentsCount(page(0, ["SHIPMENT_DISPATCH"])))).not.toContain("belgeler");
    expect(keys(undefined)).not.toContain("belgeler");
    expect(keys(cariDocumentsCount(page(3, ["SHIPMENT_DISPATCH"])))).toContain("belgeler");
  });

  it("tür etiketi belge kaydından; gelen belge kendi adıyla", () => {
    expect(cariDocLabel("SHIPMENT_DISPATCH")).toBe("Sevk İrsaliyesi");
    expect(cariDocLabel("INCOMING_DELIVERY_NOTE")).toBe("Gelen belge");
  });

  it("iptal belge durumuyla gösterilir (gizlenmez); gelen belge durumu kendi sözlüğünden", () => {
    expect(cariDocStatus({ kind: "printed", status: "VOIDED" }).label).toBe("İptal");
    expect(cariDocStatus({ kind: "printed", status: "ACTIVE" }).label).toBe("Geçerli");
    expect(cariDocStatus({ kind: "incoming", status: "CANCELLED" }).label).toBe("İptal edildi");
  });
});
