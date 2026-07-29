import { useCallback, useMemo } from "react";
import { Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat, formatNumber } from "@/lib/format";
import { rollMatchesQuery, rollMatchesContext } from "./roll-search";
import type { ShipmentDetail, ShipmentDetailRoll } from "./types";
import { ShipmentSheetSackCard } from "./ShipmentSheetSackCard";

const int = (v: number | null | undefined) => formatNumber(v, 0);
const num = (v: number | null | undefined) => formatNumber(v, 1);

/**
 * Sevkiyat hızlı-bakış panelinin gövdesi (özet + künye + sipariş + düz toplar + iade
 * + çuvallar). Panel araması `q` düz top listesini ve çuval-içi listeleri süzer;
 * araması aktif çuvallar açık gelir. Liste kumaş/renk filtresinden gelen matchItemIds/
 * matchColorIds ile eşleşen toplar amber vurgulanır; `onlyMatched` açıkken yalnız
 * eşleşenler kalır. Dosya sınırı için Sheet'ten ayrıldı.
 */
export function ShipmentSheetBody({
  d,
  q,
  matchItemIds,
  matchColorIds,
  onlyMatched,
}: {
  d: ShipmentDetail;
  q: string;
  matchItemIds: string[];
  matchColorIds: string[];
  onlyMatched: boolean;
}) {
  const hasMatchContext = matchItemIds.length > 0 || matchColorIds.length > 0;
  const isRollMatch = useCallback(
    (r: ShipmentDetailRoll): boolean =>
      hasMatchContext && rollMatchesContext(r, matchItemIds, matchColorIds),
    [hasMatchContext, matchItemIds, matchColorIds],
  );
  const onlyMatch = onlyMatched && hasMatchContext;
  const filteredSacks = useMemo(
    () =>
      d.sacks
        .map((sack) => {
          let rolls = sack.rolls.filter((r) => rollMatchesQuery(r, q, String(sack.sackNo)));
          if (onlyMatch) rolls = rolls.filter(isRollMatch);
          const matchedIds = hasMatchContext
            ? new Set(rolls.filter(isRollMatch).map((r) => r.id))
            : undefined;
          return { sack, rolls, matchedIds };
        })
        .filter((x) => (q || onlyMatch ? x.rolls.length > 0 : true)),
    [d.sacks, q, onlyMatch, hasMatchContext, isRollMatch],
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Top" value={int(d.summary.rollCount)} />
        <SummaryCard label="Toplam Metraj" value={`${int(d.summary.totalMeters)} m`} />
        <SummaryCard label="Çuval / Kg" value={`${d.summary.sackCount} · ${num(d.summary.totalKg)} kg`} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-sm">
          <Info label="Plaka" value={d.plateNumber} />
          <Info label="Sürücü" value={d.driverName} />
          <Info label="Taşıyıcı" value={d.carrier} />
          <Info label="Sevk Tarihi" value={d.dispatchedAt ? safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm") : null} />
        </CardContent>
      </Card>

      {d.orders.map((o) => (
        <Card key={o.id}>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="font-mono font-semibold">{o.orderNumber}</span>
              {o.deadline && (
                <span className="text-muted-foreground">termin {safeFormat(o.deadline, "dd.MM.yyyy")}</span>
              )}
            </div>
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-muted-foreground [&>th]:px-1 [&>th]:py-0.5 [&>th]:font-medium">
                  <th className="text-left">Kumaş</th>
                  <th className="text-right">İstenen</th>
                  <th className="text-right">Sevk</th>
                  <th className="text-right">Açık</th>
                  <th className="text-right">Bu sevk</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.lineId} className="border-t [&>td]:px-1 [&>td]:py-0.5">
                    {/* Bizdeki ad esas; müşteri adı yalnız etiketli ek (iç ekran
                        konvansiyonu — top/çuval listeleri de bizdeki adı basar). */}
                    <td className="text-left">
                      {l.item.name}
                      {l.color ? ` · ${l.color.name}` : ""}
                      {l.width ? ` · ${l.width}cm` : ""}
                      {(l.customerItemName || l.customerColorName) && (
                        <span className="text-muted-foreground">
                          {" "}
                          (Müşteride:{" "}
                          {[l.customerItemName, l.customerColorName].filter(Boolean).join(" · ")})
                        </span>
                      )}
                    </td>
                    <td className="text-right text-muted-foreground">{int(l.requested)}</td>
                    <td className="text-right text-muted-foreground">{int(l.shipped)}</td>
                    <td className="text-right text-muted-foreground">{int(l.openQty)}</td>
                    <td className="text-right font-semibold">{int(l.thisShipment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {d.summary.returnedCount > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Undo2 className="h-3.5 w-3.5" /> Bu sevkiyattan iade edilenler ({d.summary.returnedCount})
            </div>
            <div className="space-y-0.5 text-[11px]">
              {d.returnedRolls.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{r.barcode ?? "—"}</span>
                  <span className="truncate text-muted-foreground">
                    {r.item?.name}
                    {r.color ? ` · ${r.color.name}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums">{num(r.qty)} m</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {d.sacks.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Çuval İçeriği ({q || onlyMatch ? `${filteredSacks.length}/${d.sacks.length}` : d.sacks.length})
            </div>
            {filteredSacks.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">Aramaya uyan top yok.</div>
            ) : (
              <div className="space-y-2">
                {filteredSacks.map(({ sack, rolls, matchedIds }) => (
                  <ShipmentSheetSackCard
                    key={sack.id}
                    sack={sack}
                    rolls={rolls}
                    forceOpen={Boolean(q) || onlyMatch}
                    matchedIds={matchedIds}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value || "—"}</div>
    </>
  );
}
