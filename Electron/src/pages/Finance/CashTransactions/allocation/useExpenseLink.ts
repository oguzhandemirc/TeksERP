// Kasa masraf formundaki "Bağla" durumu (D4-H3): taslak + görünürlük + gövde. OFF'ta `body` null → gövde bugünkü gibi.
import { useState } from "react";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
export { ExpenseLinkSection } from "./AllocationFields";
import { allocationFieldVisible, buildAllocationBody, draftBlocksSave, emptyAllocationDraft } from "./allocationRules";

export function useExpenseLink(kind: string) {
  const [draft, setDraft] = useState(emptyAllocationDraft);
  const visible = allocationFieldVisible(useFeatureFlags().data?.data?.financeExpenseAllocationField, kind);
  return { draft, setDraft, visible, blocksSave: visible && draftBlocksSave(draft), body: visible ? buildAllocationBody(draft) : null };
}
