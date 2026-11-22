// Devere siparişi sayfasında "Çözgü düzeni": talimatın görsel hâli — tel düzeni şeridi + tarak planı.
// Veri devereciye giden talimatla AYNI uçtan (`GET /:id/instruction`: `endsSequence`, `selvedgeEnds`, tarak);
// basılı talimat aynı bilgiyi gri ton + harfle taşır. Uç düşerse bölüm sessizce gizlenmez, okunamadı der.
import { ReedPlan } from "@/components/weave/ReedPlan";
import { WarpEndsStrip } from "@/components/weave/WarpEndsStrip";
import { useWarpingInstruction } from "./yarn-service";

export function WarpLayoutSection({ orderId }: { orderId: string }) {
  const q = useWarpingInstruction(orderId, true);
  const i = q.data;
  return (
    <section className="space-y-2" aria-label="Çözgü düzeni" data-testid="warping-layout">
      <h2 className="text-base font-semibold">Çözgü düzeni</h2>
      {q.isLoading && <p className="text-xs text-muted-foreground">Yükleniyor…</p>}
      {q.isError && <p className="text-xs text-muted-foreground">Çözgü düzeni okunamadı.</p>}
      {i && (
        <div className="grid gap-4 rounded-md border p-3 lg:grid-cols-2">
          <WarpEndsStrip
            title={`Tel düzeni · ${i.warpSpec.name}`}
            yarns={i.yarns.map((y) => ({ label: y.name || y.code, endsCount: y.endsCount }))}
            endsSequence={i.endsSequence ?? null}
            sequenceNote={i.sequenceNote}
            cardEnds={i.totalEnds}
            maxWidth={560}
          />
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tarak planı</p>
            <ReedPlan endsPerDent={i.reed?.endsPerDent ?? null} reedNo={i.reed?.reedNo ?? null} totalEnds={i.totalEnds}
              selvedgeEnds={i.selvedgeEnds ?? null} endsSequence={i.endsSequence ?? null} maxWidth={560} />
          </div>
        </div>
      )}
    </section>
  );
}
