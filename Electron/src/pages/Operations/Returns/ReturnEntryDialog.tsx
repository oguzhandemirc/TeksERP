import { Loader2, PackageSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReturnGradingEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ReturnScopeChips } from "./ReturnScopeChips";
import { ReturnScopeGroups, ScopeEmptyHint } from "./ReturnScopeGroups";
import { ReturnCommonFields } from "./ReturnCommonFields";
import { ReturnLotPicker } from "./ReturnLotPicker";
import { ShipmentReturnPicker } from "./ShipmentReturnPicker";
import { useReturnEntry } from "./useReturnEntry";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/** Alt şerit: özet (N top · m · K belge) + Kapat / İade Al. */
function ReturnFooter({ summary, canSubmit, pending, onClose, onSubmit }: {
  summary: { rollCount: number; meters: number; docCount: number } | null; canSubmit: boolean; pending: boolean; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <DialogFooter className="items-center pt-2">
      {summary && (
        <span className="mr-auto text-xs text-muted-foreground">
          <strong className="text-foreground">{summary.rollCount} top</strong> · {DEC.format(summary.meters)} m
          {summary.docCount > 1 ? ` · ${summary.docCount} iade belgesi (sevkiyat başına bir belge)` : ""}
        </span>
      )}
      <Button type="button" variant="outline" onClick={onClose}>Kapat</Button>
      <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
        {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        İade Al{summary && summary.docCount > 1 ? ` (${summary.docCount} belge)` : ""}
      </Button>
    </DialogFooter>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tabancayla okutularak açıldıysa: bu barkod otomatik sorgulanır. */
  initialBarcode?: string;
}

/**
 * Masaüstünden iade girişi — DÖRT KAPSAM, TEK PENCERE (2026-09-22):
 *   okutan hiç seçmez — tek kutu top barkodu / çuval kodu (CV…) / sevkiyat no (SVK…)
 *   ön ekinden çözer; arayan çipten girer — Çuval / Sevkiyat / Sevk partisi seçicileri
 *   barkodsuz yol. Hepsi tek modele iner (sevkiyat başına grup → çuval → top); iade TOP
 *   satırıyla yazılır, neden tek, sipariş sevkiyat başına, sevkiyat başına bir belge.
 */
export function ReturnEntryDialog({ open, onOpenChange, initialBarcode }: Props) {
  const gradingEnabled = useReturnGradingEnabled();
  const s = useReturnEntry(open, initialBarcode, () => onOpenChange(false), gradingEnabled);
  // Seçiciler sevkiyat OKUMA izni ister; yoksa çipler hiç çizilmez (okutma yolları çalışır).
  const canPick = useRoleAccess().hasAnyPermission(["shipping:read", "shipping:write"]);
  const busy = s.lookupMut.isPending || s.lookupShipmentMut.isPending || s.lookupLotMut.isPending;

  const toggle = (id: string) =>
    s.setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setMany = (ids: string[], checked: boolean) =>
    s.setSelected((prev) => { const n = new Set(prev); for (const id of ids) { if (checked) n.add(id); else n.delete(id); } return n; });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) s.reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>İade Girişi</DialogTitle>
          <DialogDescription>
            Kod okutun ya da kapsam seçin; iade alınan toplar iade rafına iner, sevk muhasebesine dokunulmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Top barkodu · çuval kodu (CV…) · sevkiyat no (SVK…)"
              value={s.barcode}
              onChange={(e) => s.setBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && s.barcode.trim()) { e.preventDefault(); s.lookupMut.mutate(s.barcode); } }}
            />
            <Button type="button" variant="secondary" disabled={!s.barcode.trim() || busy} onClick={() => s.lookupMut.mutate(s.barcode)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
              <span className="ml-1">Sorgula</span>
            </Button>
          </div>
          <ReturnScopeChips active={s.activeKind} canPick={canPick} onPick={(k) => s.setPicker(k)} label={s.scope?.label ?? null} />

          {s.scope ? (
            <ReturnScopeGroups
              scope={s.scope}
              selected={s.selected}
              onToggle={toggle}
              onSetMany={setMany}
              orderByGroup={s.orderByGroup}
              onOrder={(shipmentId, orderId) => s.setOrderByGroup((m) => new Map(m).set(shipmentId, orderId))}
            />
          ) : (
            <ScopeEmptyHint />
          )}

          {s.scope && (
            <ReturnCommonFields
              scope={s.scope}
              selected={s.selected}
              orderByGroup={s.orderByGroup}
              onOrder={(shipmentId, orderId) => s.setOrderByGroup((m) => new Map(m).set(shipmentId, orderId))}
              reasons={s.reasons}
              grades={s.grades}
              gradingEnabled={gradingEnabled}
              reasonId={s.reasonId} setReasonId={s.setReasonId}
              reasonText={s.reasonText} setReasonText={s.setReasonText}
              note={s.note} setNote={s.setNote}
              qualityGradeId={s.qualityGradeId} setQualityGradeId={s.setQualityGradeId}
            />
          )}
        </div>

        <ReturnFooter summary={s.scope ? s.summary : null} canSubmit={s.canSubmit} pending={s.createMut.isPending} onClose={() => onOpenChange(false)} onSubmit={() => s.createMut.mutate()} />
      </DialogContent>
      {/* Seçiciler iade OLUŞTURMAZ; kapsamı yükler, aynı kapı (neden · sipariş · kalite) sonra. */}
      <ShipmentReturnPicker
        open={s.picker === "sack" || s.picker === "shipment"}
        mode={s.picker === "shipment" ? "shipment" : "sack"}
        onOpenChange={(o) => !o && s.setPicker(null)}
        onPick={(sackNo) => { s.setBarcode(sackNo); s.lookupMut.mutate(sackNo); }}
        onPickShipment={(id) => s.lookupShipmentMut.mutate(id)}
      />
      <ReturnLotPicker open={s.picker === "lot"} onOpenChange={(o) => !o && s.setPicker(null)} onPick={(id) => s.lookupLotMut.mutate(id)} />
    </Dialog>
  );
}
