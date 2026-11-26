// İE hedef ürünü yalnız KUMAŞ: iplik/sarf kartı hedef olarak sunulmaz — tür süzgeci liste isteğiyle sunucuya gider.
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { TargetItemPicker } from "./TargetItemPicker";
import type { WorkOrderFormValues } from "./schema";

const captured: Array<Record<string, unknown>> = [];
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ filters }: { filters: Record<string, unknown> }) => {
    captured.push(filters);
    return null;
  },
}));
vi.mock("@/pages/Items/useItemRecordForm", () => ({ useItemRecordForm: () => undefined }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: {} } }) }));

function Host({ use }: { use: "plan" | "definition" }) {
  const { control } = useForm<WorkOrderFormValues>();
  return <TargetItemPicker control={control} use={use} />;
}

describe("TargetItemPicker", () => {
  it.each(["plan", "definition"] as const)("%s: liste isteği itemType=FABRIC taşır", (use) => {
    captured.length = 0;
    render(<Host use={use} />);
    expect(captured.at(-1)).toEqual(expect.objectContaining({ itemType: "FABRIC" }));
    expect(String(captured.at(-1)?.itemType)).not.toMatch(/YARN|CONSUMABLE/);
  });
});
