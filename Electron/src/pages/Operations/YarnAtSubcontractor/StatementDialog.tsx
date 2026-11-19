// =============================================================================
// FASONCU İPLİK EKSTRESİ penceresi — fasoncu seç → Excel / PDF / Yazdır
// =============================================================================
// Mevcut emanet ekstresi (#639/#644) MÜŞTERİ (emanet sahibi) anahtarlıdır; fasoncu kırılımı yok. Bu pencere fasoncu
// bazında belgeyi aynı Fasondaki İplik ucundan kurar; fasoncuda müşteri malı varsa o müşterinin emanet ekstresine
// (İçerideki İşler › Emanet ekstresi) bağlantı verir. Sahibi/Değer sütunları OPT-IN (belge dışarı gidebilir).
// =============================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoPopover } from "@/components/ui/info-popover";
import { Label } from "@/components/ui/label";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { kg } from "../Yarn/qty";
import { subLabel } from "./model";
import { buildSubcontractorStatement } from "./statementExport";
import { useYarnAtSubcontractor, type YarnAtSubRow } from "./service";

const CONSIGNED_STATEMENT_HREF = (customerId: string) => `/operations/icerideki-isler?view=ekstre&musteri=${encodeURIComponent(customerId)}`;

function subsOf(rows: readonly YarnAtSubRow[]) {
  const m = new Map<string, { id: string; name: string; kg: number }>();
  for (const r of rows) {
    const s = m.get(r.subcontractorId) ?? { id: r.subcontractorId, name: subLabel(r), kg: 0 };
    s.kg += Number(r.kg) || 0;
    m.set(r.subcontractorId, s);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

function Opt({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-50")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">{label}</Label>
      <InfoPopover desc={hint} label={`${label} açıklaması`} />
    </div>
  );
}

function OwnerLinks({ rows }: { rows: readonly YarnAtSubRow[] }) {
  const emanet = useEmanetEnabled();
  const { hasPermission } = useRoleAccess();
  const owners = [...new Map(rows.filter((r) => r.ownerCustomerId).map((r) => [r.ownerCustomerId!, r.ownerCustomerName ?? "Müşteri"])).entries()];
  if (!emanet || !hasPermission("roll:read") || owners.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="text-muted-foreground">Bu fasoncuda müşteri malı (emanet) iplik var — müşterinin dönem mutabakatı:</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {owners.map(([id, name]) => (
          <li key={id}><Link to={CONSIGNED_STATEMENT_HREF(id)} className="underline decoration-dotted underline-offset-4 hover:decoration-solid">{name} emanet ekstresi →</Link></li>
        ))}
      </ul>
    </div>
  );
}

export function StatementDialog({ initialSubcontractorId, canSeeValue, onClose }: { initialSubcontractorId?: string; canSeeValue: boolean; onClose: () => void }) {
  const all = useYarnAtSubcontractor({}, true);
  const subs = useMemo(() => subsOf(all.data ?? []), [all.data]);
  const [subId, setSubId] = useState<string | undefined>(initialSubcontractorId);
  const [includeOwner, setIncludeOwner] = useState(false);
  const [includeValue, setIncludeValue] = useState(false);
  const one = useYarnAtSubcontractor({ subcontractorId: subId }, Boolean(subId));
  const rows = one.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fasoncu ekstresi</DialogTitle>
          <DialogDescription>Seçilen fasoncuda bugün duran iplik — lot ve sipariş kırılımıyla. Excel, PDF ya da yazıcıya alın.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Fasoncu</p>
            {all.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
            {all.isError && <p role="alert" className="text-sm text-destructive">Fasoncular okunamadı.</p>}
            {!all.isLoading && subs.length === 0 && <p className="text-sm text-muted-foreground">Hiçbir fasoncuda iplik yok.</p>}
            <ul role="radiogroup" aria-label="Fasoncu" className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {subs.map((s) => (
                <li key={s.id}>
                  <button type="button" role="radio" aria-checked={subId === s.id} onClick={() => setSubId(s.id)}
                    className={cn("flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted", subId === s.id && "bg-primary/10 font-medium text-primary")}>
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{kg(s.kg)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">Belgeye eklenecek iç bilgiler</p>
            <Opt id="st-owner" checked={includeOwner} onChange={setIncludeOwner} label="Sahibi sütunu" hint="İpliğin kime ait olduğu (bizim / müşteri adı). Belge fasoncuya gidecekse başka müşterinin adını göstermemek için kapalı bırakın." />
            <Opt id="st-value" checked={includeValue} onChange={setIncludeValue} disabled={!canSeeValue} label="Değer sütunları" hint={canSeeValue ? "Birim fiyat (mal kabuldeki lot fiyatı) ve değer. İç bilgidir; fasoncuya giden belgede kapalı tutun." : "Mal kabul fiyatlarını görme yetkiniz yok."} />
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm text-muted-foreground">{subId ? (one.isLoading ? "Yükleniyor…" : `${rows.length} satır`) : "Önce fasoncu seçin"}</span>
              <ReportExportBar disabled={!subId || rows.length === 0} buildSpec={() => buildSubcontractorStatement(rows, { includeOwner, includeValue: includeValue && canSeeValue })} />
            </div>
            <OwnerLinks rows={rows} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
