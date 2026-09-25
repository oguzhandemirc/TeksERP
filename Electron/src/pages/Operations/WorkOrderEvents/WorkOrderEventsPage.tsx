// =============================================================================
// İŞ EMRİ HAREKETLERİ — ayrı ekran (Operasyon → İş Emri Hareketleri)
// =============================================================================
// İş emri numarası ya da top barkoduyla (okutma da olur — el okuyucusu klavye
// gibi yazar) iş emri bulunur; hareketleri yan paneldekiyle AYNI gövdede
// (`WorkOrderEventsPanel`) gösterilir. Barkod birden çok iş emrinden geçmişse liste
// sunulur, seçim kullanıcıdadır.
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import { lookupWorkOrdersForEvents, type LookupHit } from "../WorkOrders/events";
import { WorkOrderEventsPanel } from "../WorkOrders/WorkOrderEventsPanel";

export function WorkOrderEventsPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<LookupHit | null>(null);
  const search = useMutation({
    mutationFn: (term: string) => lookupWorkOrdersForEvents(term),
    // Tek sonuç doğrudan açılır — okutup beklemek "simple is more" değil.
    onSuccess: (hits) => setSelected(hits.length === 1 ? hits[0]! : null),
  });
  const hits = search.data ?? [];
  return (
    <PageShell>
      <PageHeader
        title="İş Emri Hareketleri"
        description="İş emri numarası ya da top barkodu ile iş emrinin bütün hareketleri"
      />
      <PageBody className="flex flex-col p-6">
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 2) search.mutate(q.trim());
          }}
        >
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="İş emri no (IE…) ya da top barkodu okutun"
            aria-label="İş emri no ya da top barkodu"
          />
          <Button type="submit" disabled={q.trim().length < 2 || search.isPending}>
            {search.isPending ? "Aranıyor…" : "Ara"}
          </Button>
        </form>
        {search.isError && (
          <p className="mt-3 text-sm text-destructive">Arama yapılamadı — bu “bulunamadı” demek değildir, tekrar deneyin.</p>
        )}
        {search.isSuccess && hits.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Bu numara ya da barkodla iş emri bulunamadı.</p>
        )}
        {hits.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Top {hits.length} iş emrinden geçti:</span>
            {hits.map((h) => (
              <Button key={h.id} size="sm" variant={selected?.id === h.id ? "default" : "outline"} onClick={() => setSelected(h)}>
                {h.workOrderNumber} · {workOrderStatusLabels[h.status as WorkOrderStatus] ?? h.status}
              </Button>
            ))}
          </div>
        )}
        {selected && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <h2 className="text-base font-semibold">{selected.workOrderNumber}</h2>
            <WorkOrderEventsPanel workOrder={selected} />
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
