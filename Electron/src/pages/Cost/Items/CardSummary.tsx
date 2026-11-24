// Kart verisi SALT-OKUNUR (çözgü/atkı kartından gelir; burada düzenlenmez) — her değer kaynağıyla.
// Bağlı değilse iki kartta da aynı dil: kırmızı "Bağlı değil" rozeti + sağ üstte git düğmesi (B12/5).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { SectionCard } from "@/components/ui/section-card";
import type { CostInputSnap, Sourced } from "../shared/cost-types";
import { fmtDecFull, fmtQtyDecFull } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";

const src = (s: Sourced | undefined) => (s ? `${fmtDecFull(s.value)} (${SOURCE_LABEL[s.source] ?? s.source})` : "—");

function SpecCard({ title, bound, info, to, linkLabel, children }: {
  title: string; bound: boolean; info: string; to: string; linkLabel: string; children: ReactNode;
}) {
  return (
    <SectionCard
      title={title}
      titleExtra={
        <>
          <InfoPopover desc={info} label={`${title} açıklaması`} />
          {bound ? <Badge variant="success">Bağlı</Badge> : <Badge variant="danger">Bağlı değil</Badge>}
        </>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link to={to}>{linkLabel}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </Button>
      }
    >
      <div className="text-sm">{children}</div>
    </SectionCard>
  );
}

export function CardSummary({ g }: { g: CostInputSnap }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SpecCard title="Çözgü" bound={!!g.warp} to="/definitions/warp-specs" linkLabel="Çözgü kartları"
        info="Çözgü verisi ürüne bağlı çözgü kartından okunur; burada değiştirilmez. Kart bağlı değilse iplik ve fire hesaplanamaz.">
        {g.warp ? (
          <p className="text-muted-foreground">
            {g.warp.endsCount} tel · {g.warp.yarn.name} {fmtQtyDecFull(g.warp.yarn.denier.value)} den · çekme %{src(g.warp.takeUpPct)} · fire %{src(g.warp.wastePct)}
          </p>
        ) : <p className="text-muted-foreground">Çözgü kartı bağlı değil.</p>}
      </SpecCard>
      <SpecCard title="Atkı" bound={!!g.weft} to="/definitions/items" linkLabel="Ürün kartı"
        info="Atkı verisi ürün kartındaki atkı tanımından okunur; burada değiştirilmez.">
        {g.weft ? (
          <p className="text-muted-foreground">
            {src(g.weft.picksPerCm)} atkı/cm · atkı boyu {src(g.weft.lengthCm)} cm ·{" "}
            {g.weft.yarns.map((y) => `${y.name} ${fmtQtyDecFull(y.denier.value)} den (pay ${y.picksInRepeat ?? "—"})`).join(" + ")}
          </p>
        ) : <p className="text-muted-foreground">Atkı kartı bağlı değil.</p>}
        {g.loomPick && (
          <p className="mt-1 text-muted-foreground" data-testid="card-loom-pick">
            Dokuma atkı ücreti: {g.loomPick.rate ? `${fmtDecFull(g.loomPick.rate.amount, 4)} ${g.loomPick.rate.currency} (${SOURCE_LABEL[g.loomPick.rate.source] ?? g.loomPick.rate.source})` : "yok"}
          </p>
        )}
      </SpecCard>
    </div>
  );
}
