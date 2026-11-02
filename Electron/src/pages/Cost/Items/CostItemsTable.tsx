import { Badge } from "@/components/ui/badge";
import { fmtFactoryDate } from "@/lib/factory-time";
import { fmtDec } from "../shared/format";
import { STRUCTURE_STATUS_LABEL } from "../shared/labels";
import { presentationAmount } from "../shared/PresentationNote";
import type { CostItemRow } from "./service";

const STATUS_CLASS: Record<string, string> = {
  TAM: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  VARSAYILAN: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  YAPI_EKSIK: "bg-destructive/15 text-destructive",
};

export function CostItemsTable({ rows, onOpen }: { rows: CostItemRow[]; onOpen: (itemId: string) => void }) {
  return (
    <table className="w-full min-w-[36rem] text-sm">
      <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-3 py-2">Ürün</th><th className="px-3 py-2 text-right">Std. maliyet</th><th className="px-3 py-2">Sürüm</th>
          <th className="px-3 py-2">Tarih</th><th className="px-3 py-2">Durum</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.itemId} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.itemId)}>
            <td className="px-3 py-2"><span className="font-medium">{r.kod}</span> <span className="text-muted-foreground">{r.ad}</span></td>
            <td className="px-3 py-2 text-right tabular-nums">
              {/* SY-J1: sunum dövizi ayarlıysa döviz birincil, TL ikincil (ikisi de sunucu sayısı). */}
              {r.aktifSurum?.sunumDovizi ? (
                <>
                  {presentationAmount(r.aktifSurum, r.aktifSurum.standartDovizM)}
                  <span className="block text-xs text-muted-foreground">{fmtDec(r.aktifSurum.standartTlM)} TL/m</span>
                </>
              ) : r.aktifSurum ? `${fmtDec(r.aktifSurum.standartTlM)} TL/m` : "—"}
            </td>
            <td className="px-3 py-2">{r.aktifSurum ? `v${r.aktifSurum.surumNo}` : "—"}</td>
            <td className="px-3 py-2">{r.aktifSurum ? fmtFactoryDate(r.aktifSurum.hesaplananAt) : "—"}</td>
            <td className="space-x-1 px-3 py-2 whitespace-nowrap">
              <Badge variant="muted" className={STATUS_CLASS[r.yapiDurumu]}>{STRUCTURE_STATUS_LABEL[r.yapiDurumu] ?? r.yapiDurumu}</Badge>
              {r.girdiDegisti && <Badge variant="muted" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Girdi değişti</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
