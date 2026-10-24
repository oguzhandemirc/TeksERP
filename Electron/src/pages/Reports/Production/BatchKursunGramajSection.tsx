import { useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import { ProcessSummaryCard } from "@/pages/Operations/WorkOrders/detail-v3/ProcessSummaryCard";

/** KQ-D6: İE kartıyla AYNI özet, parti kapsamında (salt okunur); gramaj özelliği tanımlı değilse çizilmez. */
export function BatchKursunGramajSection({ batchId }: { batchId: string }) {
  const { catalog } = useKursunGramajCatalog();
  if (!catalog.propertyId) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Kurşun gramajı</h3>
      <ProcessSummaryCard scope={{ batchId }} />
    </section>
  );
}
