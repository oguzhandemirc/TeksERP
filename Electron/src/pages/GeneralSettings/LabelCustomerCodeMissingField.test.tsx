// D4-F3: `label.customerCodeMissing` panel satırı — varsayılan BLOCK (backend ile birebir),
// ROLL_BARCODE seçilip kaydedilince PATCH yalnız `labelCustomerCodeMissing` taşır.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let flags: Record<string, unknown> = {};
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ data: { data: flags }, isLoading: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
const update = vi.fn();
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: { update: (b: unknown) => update(b) },
}));

import { LabelSettingsSection } from "./LabelSettingsSection";
import { DEFAULT_LABEL_CUSTOMER_CODE_MISSING } from "./LabelCustomerCodeMissingField";

beforeEach(() => {
  update.mockReset().mockResolvedValue({ success: true, data: {} });
  flags = { labelCopies: 1, labelCopiesSource: "GLOBAL", labelCustomerCodeMissing: "BLOCK" };
});

describe("Müşteri barkodu yoksa (label.customerCodeMissing)", () => {
  it("varsayılan backend DEFAULT_LABEL_CUSTOMER_CODE_MISSING ile aynı", () => {
    const src = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/services/system-setting.service.ts"), "utf8");
    const m = src.match(/DEFAULT_LABEL_CUSTOMER_CODE_MISSING: LabelCustomerCodeMissing = "([A-Z_]+)"/);
    expect(m?.[1]).toBe(DEFAULT_LABEL_CUSTOMER_CODE_MISSING);
  });

  it("bayrak gelmezse (eski sunucu) 'basılmasın' seçili", () => {
    flags = { labelCopies: 1 };
    renderWithProviders(<LabelSettingsSection />);
    expect((screen.getByRole("radio", { name: /Etiket basılmasın/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("iç barkod seçilip kaydedilince gövde yalnız labelCustomerCodeMissing taşır", async () => {
    renderWithProviders(<LabelSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: /Bizim top barkodu basılsın/ }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ labelCustomerCodeMissing: "ROLL_BARCODE" });
  });
});
