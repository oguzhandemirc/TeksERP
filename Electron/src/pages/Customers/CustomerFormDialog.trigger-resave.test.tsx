// BEKÇİ (K2b inceleme): açık diyalogda tetik kaydedilip ESKİ değere dönülünce ikinci kayıt da tetiği gönderir
// (tohum kayıttan sonra kaydedilen değere eşitlenir) ve kayıt `by-customer` önbelleğini tazeler.
import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { CustomerFormDialog } from "./CustomerFormDialog";
import { financeSubBody } from "./customerFinance";
import type { CustomerFormValues } from "./schema";

vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/forms/DocumentProfileSelect", () => ({ DocumentProfileSelect: () => null }));
vi.mock("./CustomerBranchesDraftField", () => ({ CustomerBranchesDraftField: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useCustomerBranchesEnabled: () => false, usePricingEnabled: () => false, useMaliyetEnabled: () => false, useFeatureFlags: () => ({ data: { data: { financeEnabled: true } } }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
// Finans bölümü yerine: by-customer'dan PERIOD_END tohumlar, iki düğmeyle tetik seçtirir (radyo yerine).
vi.mock("./CustomerFinanceSection", () => ({
  useCustomerFinanceAccess: () => ({ canRead: true, canWrite: true, enabled: true }),
  CustomerFinanceSection: ({ form }: { form: UseFormReturn<CustomerFormValues> }) => {
    useEffect(() => {
      form.setValue("financeServiceBillingTrigger", "PERIOD_END", { shouldDirty: false });
      form.setValue("financeServiceBillingTriggerSeed", "PERIOD_END", { shouldDirty: false });
    }, [form]);
    return (
      <div>
        <button type="button" onClick={() => form.setValue("financeServiceBillingTrigger", "PER_SHIPMENT", { shouldDirty: true })}>sevkte</button>
        <button type="button" onClick={() => form.setValue("financeServiceBillingTrigger", "PERIOD_END", { shouldDirty: true })}>donemde</button>
      </div>
    );
  },
}));

describe("CustomerFormDialog — hizmet faturası tetiği yeniden kayıt", () => {
  it("⭐ kaydet (PER_SHIPMENT) → aynı diyalogda eski değere dön (PERIOD_END) → kaydet: ikinci gövdede tetik VAR; by-customer tazelenir", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const onSubmit = vi.fn();
    renderWithProviders(<CustomerFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(document.getElementById("name") as HTMLInputElement, "Perde A.Ş.");
    const opts = { canWrite: true, enabled: true };

    await userEvent.click(screen.getByRole("button", { name: "sevkte" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(financeSubBody(onSubmit.mock.calls[0]![0], opts).finance).toHaveProperty("serviceBillingTrigger", "PER_SHIPMENT");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finance", "cari"] }));

    await userEvent.click(screen.getByRole("button", { name: "donemde" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(financeSubBody(onSubmit.mock.calls[1]![0], opts).finance).toHaveProperty("serviceBillingTrigger", "PERIOD_END");
    invalidate.mockRestore();
  });
});
