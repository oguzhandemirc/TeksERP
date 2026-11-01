// Cari Hesaplar tablosu — liste standardı: sayfanın ListBody'si içinde kenardan kenara (kart yok). CariPage max-lines sınırı için ayrıldı.
import { FileSpreadsheet, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { cariRoleLabel, money, type CariRow } from "./service";
import { CariRowActions, CariStatusBadges } from "./CariRowExtras";

/**
 * Para birimi başına AYRI satır — tek sayıya indirmek 1000 USD ile 30.000 TL'yi toplamak olurdu.
 * İşaret bakiyeyle aynı: POZİTİF = cari bize borçlu. Bakiye: yeşil/kırmızı; gecikmiş: alacağımız gecikti kırmızı,
 * borcumuz gecikti amber.
 */
function MoneyStack({ items, tone }: { items: Array<{ currency: CariRow["defaultCurrency"]; amount: number | string }>; tone: "balance" | "overdue" }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  const cls = (v: number) =>
    tone === "balance"
      ? v > 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"
      : v > 0 ? "font-medium text-destructive" : "font-medium text-amber-600 dark:text-amber-400";
  return (
    <div className="flex flex-col items-end gap-0.5">
      {items.map((it) => (
        <span key={it.currency} className={cls(Number(it.amount))}>
          {money(it.amount, it.currency)}
        </span>
      ))}
    </div>
  );
}

interface Props {
  rows: CariRow[];
  onStatement: (row: CariRow) => void;
  onHold: (row: CariRow) => void;
  onEdit: (row: CariRow) => void;
}

export function CariTable({ rows, onStatement, onHold, onEdit }: Props) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
        <tr>
          <th className="px-3 py-2 text-left">Kod</th>
          <th className="px-3 py-2 text-left">Ünvan</th>
          <th className="px-3 py-2 text-left">Tür</th>
          {/* "Vade" (anlaşılan gün) ile "Gecikmiş" (vadesi geçmiş açık
              TUTAR) AYRI sorulardır — ikisi de kalır. */}
          <th className="px-3 py-2 text-left">Vade</th>
          <th className="px-3 py-2 text-right">Bakiye</th>
          <th className="px-3 py-2 text-right">Gecikmiş</th>
          <th className="px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t">
            <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
            <td className="px-3 py-2 font-medium">
              <span className={c.isActive ? undefined : "text-muted-foreground"}>{c.name}</span>
              <CariStatusBadges row={c} />
            </td>
            <td className="px-3 py-2">
              <Badge variant="outline">{cariRoleLabel(c)}</Badge>
            </td>
            <td className="px-3 py-2 text-muted-foreground">
              {/* `0` = peşin; `|| "—"` yazmak onu "vadesiz" gibi gösterirdi. */}
              {c.paymentTermDays != null
                ? c.paymentTermDays === 0
                  ? "Peşin"
                  : `${c.paymentTermDays} gün`
                : "—"}
            </td>
            <td className="px-3 py-2 text-right">
              <MoneyStack items={c.balances.map((b) => ({ currency: b.currency, amount: b.balance }))} tone="balance" />
            </td>
            <td className="px-3 py-2 text-right">
              {/* Vadesi geçmiş AÇIK tutar — kaynağı yaşlandırma çekirdeğinin `overdueTotal`'ı (efektif vade +
                  sanal FIFO mahsup DAHİL; Yaşlandırma raporuyla BİREBİR aynı rakam). */}
              <MoneyStack items={c.overdue ?? []} tone="overdue" />
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => onStatement(c)}>
                  <FileSpreadsheet className="mr-1 h-4 w-4" />
                  Ekstre
                </Button>
                <CariRowActions row={c} onHold={() => onHold(c)} />
                <PermissionGate permission="finance:write">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(c)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Düzenle
                  </Button>
                </PermissionGate>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
