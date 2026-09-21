import { AlertTriangle } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { candidateOrders, type ReturnScope } from "./returnScope";

const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Named { id: string; name: string; code?: string }

/**
 * ORTAK ALANLAR — neden (zorunlu) · kalite (bayrakla) · not; sipariş yalnız TEK gruplu
 * top/çuval kapsamında burada (çok gruplu ve sevkiyat kapsamında grup kartının içinde).
 */
export function ReturnCommonFields(p: {
  scope: ReturnScope;
  selected: ReadonlySet<string>;
  orderByGroup: ReadonlyMap<string, string | null>;
  onOrder: (shipmentId: string, orderId: string | null) => void;
  reasons: Named[];
  grades: Named[];
  gradingEnabled: boolean;
  reasonId: string | null; setReasonId: (v: string | null) => void;
  reasonText: string; setReasonText: (v: string) => void;
  note: string; setNote: (v: string) => void;
  qualityGradeId: string | null; setQualityGradeId: (v: string | null) => void;
}) {
  const hasReason = !!p.reasonId || p.reasonText.trim().length > 0;
  const singleGroup = p.scope.groups.length === 1 && (p.scope.kind === "ROLL" || p.scope.kind === "SACK") ? p.scope.groups[0]! : null;
  const cands = singleGroup ? candidateOrders(singleGroup, p.selected) : [];
  const multi = p.scope.groups.flatMap((g) => g.sacks.flatMap((s) => s.rolls)).length > 1;
  return (
    <>
      {singleGroup && (
        <FormField label="Sipariş" hint={p.scope.kind === "SACK" ? "Seçilen TÜM toplara uygulanır; yalnız hepsine uyan siparişler listelenir." : undefined}>
          {cands.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Bu sevkiyatta uyan sipariş yok — iade siparişe bağlanmadan kaydedilecek.
            </div>
          ) : (
            <Select value={p.orderByGroup.get(singleGroup.shipment.id) ?? ""} onValueChange={(v) => p.onOrder(singleGroup.shipment.id, v || null)}>
              <SelectTrigger><SelectValue placeholder="Sipariş seçin..." /></SelectTrigger>
              <SelectContent>{cands.map((o) => (<SelectItem key={o.id} value={o.id}>{o.orderNumber}</SelectItem>))}</SelectContent>
            </Select>
          )}
        </FormField>
      )}

      <FormField label="İade Nedeni" required hint={!hasReason ? "Katalogdan seçin VEYA açıklama yazın." : undefined}>
        <Select value={p.reasonId ?? ""} onValueChange={(v) => p.setReasonId(v || null)}>
          <SelectTrigger><SelectValue placeholder="Neden seçin..." /></SelectTrigger>
          <SelectContent>{p.reasons.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}</SelectContent>
        </Select>
        <textarea className={`mt-2 ${TEXTAREA_CLS}`} rows={2} placeholder="Açıklama (katalog seçmediysen yaz)" value={p.reasonText} onChange={(e) => p.setReasonText(e.target.value)} />
      </FormField>

      {p.gradingEnabled && (
        <FormField label="Kalite" hint={multi ? "Seçilirse TÜM seçili toplara uygulanır; seçilmezse her top çıktığı kaliteyle döner." : "Seçilmezse top çıktığı kaliteyle döner."}>
          <Select value={p.qualityGradeId ?? ""} onValueChange={(v) => p.setQualityGradeId(v || null)}>
            <SelectTrigger><SelectValue placeholder="Değiştirme" /></SelectTrigger>
            <SelectContent>{p.grades.map((g) => (<SelectItem key={g.id} value={g.id}>{g.name}{g.code ? ` (${g.code})` : ""}</SelectItem>))}</SelectContent>
          </Select>
        </FormField>
      )}

      <FormField label="Not">
        <textarea className={TEXTAREA_CLS} rows={2} placeholder="Teslim alan notu (opsiyonel)" value={p.note} onChange={(e) => p.setNote(e.target.value)} />
      </FormField>
    </>
  );
}
