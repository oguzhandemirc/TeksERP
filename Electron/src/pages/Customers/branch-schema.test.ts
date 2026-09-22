// BEKÇİ — şube formu → istek gövdesi (S3, 2026-09-23): gövdeyi elle kuran katman sessiz bir
// allowlist'tir; `defaultDestination` gövdeye girer, "seçilmedi" null olarak gider (temizler).
import { describe, expect, it } from "vitest";
import { branchFormDefaults, branchFormSchema, branchFormToPayload, exportCodeVisible } from "./branch-schema";
import { branchDraftDefaults, customerFormDefaults } from "./schema";
import { buildCustomerPayload } from "./CustomersPage";

describe("branchFormToPayload", () => {
  it("⭐ sevk yönü gövdeye girer", () => {
    expect(branchFormToPayload({ ...branchFormDefaults, name: "Merkez", defaultDestination: "EXPORT" }).defaultDestination).toBe("EXPORT");
  });
  it("seçilmedi → null (şubenin yönü temizlenir, cariye düşülür)", () => {
    const body = branchFormToPayload({ ...branchFormDefaults, name: "Merkez" });
    expect("defaultDestination" in body).toBe(true);
    expect(body.defaultDestination).toBeNull();
  });
  it("şema enum dışını reddeder", () => {
    expect(branchFormSchema.safeParse({ ...branchFormDefaults, name: "Merkez", defaultDestination: "OVERSEAS" }).success).toBe(false);
  });
});

describe("exportCodeVisible + gizlenen kod SİLİNMEZ (S4, 2026-09-23)", () => {
  it("yalnız yurtdışında görünür; şube yönü boşsa carininkine düşer", () => {
    expect(exportCodeVisible("EXPORT")).toBe(true);
    expect(exportCodeVisible("DOMESTIC", "EXPORT")).toBe(false);
    expect(exportCodeVisible(null, "EXPORT")).toBe(true);
    expect(exportCodeVisible(null, null)).toBe(false);
  });
  it("⭐ yurtiçi şube + dolu ihracat kodu → gövde kodu TAŞIR (gizlemek silmek değil)", () => {
    const body = branchFormToPayload({ ...branchFormDefaults, name: "Merkez", code: "EXP-B", defaultDestination: "DOMESTIC" });
    expect(body.code).toBe("EXP-B");
  });
  it("⭐ yurtiçi cari + dolu ihracat kodu → kart kaydında kod yerinde kalır", () => {
    const v = { ...customerFormDefaults, name: "ARZU", exportCode: "EXP-C", defaultDestination: "DOMESTIC" as const };
    expect(buildCustomerPayload(v, null).exportCode).toBe("EXP-C");
  });
  it("satır-içi şube taslağının yönü gövdeye girer", () => {
    const v = { ...customerFormDefaults, name: "ARZU", branches: [{ ...branchDraftDefaults, name: "Depo", defaultDestination: "EXPORT" as const }] };
    expect(buildCustomerPayload(v, null).branches?.[0]?.defaultDestination).toBe("EXPORT");
  });
});
