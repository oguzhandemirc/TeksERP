// Kart verisi SALT-OKUNUR (çözgü/atkı kartından gelir; burada düzenlenmez) — her değer kaynağıyla.
import { Link } from "react-router-dom";
import type { CostInputSnap, Sourced } from "../shared/cost-types";
import { fmtDecFull } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";

const src = (s: Sourced | undefined) => (s ? `${fmtDecFull(s.value)} (${SOURCE_LABEL[s.source] ?? s.source})` : "—");

export function CardSummary({ g }: { g: CostInputSnap }) {
  return (
    <div className="grid gap-3 text-sm md:grid-cols-2">
      <section className="rounded-md border p-3">
        <h3 className="mb-1 font-medium">Çözgü</h3>
        {g.warp ? (
          <p className="text-muted-foreground">
            {g.warp.endsCount} tel · {g.warp.yarn.name} {fmtDecFull(g.warp.yarn.denier.value)} den · çekme %{src(g.warp.takeUpPct)} · fire %{src(g.warp.wastePct)}
          </p>
        ) : <p className="text-destructive">Çözgü kartı bağlı değil.</p>}
        <Link className="text-xs underline" to="/definitions/warp-specs">Çözgü kartlarına git</Link>
      </section>
      <section className="rounded-md border p-3">
        <h3 className="mb-1 font-medium">Atkı</h3>
        {g.weft ? (
          <p className="text-muted-foreground">
            {src(g.weft.picksPerCm)} atkı/cm · atkı boyu {src(g.weft.lengthCm)} cm ·{" "}
            {g.weft.yarns.map((y) => `${y.name} ${fmtDecFull(y.denier.value)} den (pay ${y.picksInRepeat ?? "—"})`).join(" + ")}
          </p>
        ) : <p className="text-destructive">Atkı kartı bağlı değil.</p>}
        <Link className="text-xs underline" to="/definitions/items">Ürün kartına git</Link>
      </section>
    </div>
  );
}
