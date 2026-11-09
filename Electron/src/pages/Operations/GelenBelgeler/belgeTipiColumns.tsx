// Belge Tipleri tablosu sütunları (iş emri listesiyle aynı DataTable). Satır sonu eylemler ikondur; tıklama satırı
// açmasın diye eylem hücresi olayı durdurur (portal'lı diyaloglar da React ağacında bu hücreden kabarır).
import { useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Ban, Camera, RotateCcw, Undo2 } from "lucide-react";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { SenderTemplatePatch, SenderTemplateView } from "./types";
import { UserTemplateEditButton } from "./tanit/UserTemplateEdit";
import { RemarkDialog } from "./tanit/RemarkDialog";
import { isOrphan, isUserTemplate } from "./BelgeTipiKarti";

/** Motor bu tiple belge tanır mı — tablo "Durum" ve kullanılmayan süzmesi aynı yüklemi okur. */
export const isInUse = (r: SenderTemplateView) => r.isActive && (isUserTemplate(r) || r.inFile);

export interface BelgeTipiActions {
  busyCode: string | null;
  onPatch: (code: string, patch: SenderTemplatePatch) => void;
  onReset: (code: string) => void;
}

function IconAction({ label, title, onClick, disabled, className, testId, children }: { label: string; title: string; onClick: () => void; disabled?: boolean; className?: string; testId?: string; children: ReactNode }) {
  return (
    <Button size="icon" variant="ghost" className={`h-8 w-8 ${className ?? ""}`} title={title} aria-label={label} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </Button>
  );
}

function RowActions({ row, a }: { row: SenderTemplateView; a: BelgeTipiActions }) {
  const [remark, setRemark] = useState(false);
  const busy = a.busyCode === row.code;
  let body: ReactNode;
  if (!isInUse(row)) {
    body = isOrphan(row) ? (
      <Badge variant="outline">Okuma motorunda artık yok</Badge>
    ) : (
      <IconAction label={`${row.name} geri al`} title="Geri al (yeniden kullanıma aç)" disabled={busy} onClick={() => a.onPatch(row.code, { isActive: true })}>
        <Undo2 className="h-4 w-4" />
      </IconAction>
    );
  } else if (!isUserTemplate(row)) {
    // Hazır (dosya) tip: tanımı koddadır; yalnız kullanılmaz yapılabilir.
    body = (
      <IconAction label={`${row.name} kullanma`} title="Kullanma" disabled={busy} onClick={() => a.onPatch(row.code, { isActive: false })}>
        <Ban className="h-4 w-4" />
      </IconAction>
    );
  } else {
    body = (
      <>
        <UserTemplateEditButton code={row.code} name={row.name} compact />
        <IconAction label={`${row.name} fotoğrafla yeniden işaretle`} title="Fotoğrafla yeniden işaretle" onClick={() => setRemark(true)} testId={`template-remark-${row.code}-row`}>
          <Camera className="h-4 w-4" />
        </IconAction>
        <IconAction label={`${row.name} sıfırla`} title="Sıfırla" className="text-destructive" onClick={() => a.onReset(row.code)} testId={`template-reset-${row.code}-row`}>
          <RotateCcw className="h-4 w-4" />
        </IconAction>
        {remark && <RemarkDialog code={row.code} name={row.name} onOpenChange={setRemark} />}
      </>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}

/** Gönderen hücreden seçilir (PATCH senderCustomerId). Boş gönderenli aktif tipte okunan belge gönderensiz gelir —
 *  Gelen Belgeler'deki boş Gönderen sütununun nedeni budur; satırda uyarılır. Yetim satır PATCH almaz → düz metin. */
function SenderCell({ r, a }: { r: SenderTemplateView; a: BelgeTipiActions }) {
  if (isOrphan(r)) return <span>{r.senderCustomer?.name ?? "—"}</span>;
  return (
    <div className="min-w-[12rem] max-w-[18rem] space-y-1" onClick={(e) => e.stopPropagation()} data-testid={`template-sender-${r.code}`}>
      <CustomerPickerField value={r.senderCustomer?.id ?? null} onChange={(id) => a.onPatch(r.code, { senderCustomerId: id })} disabled={a.busyCode === r.code} variant="cari" clearable placeholder="Gönderen seç" triggerClassName="h-8 text-xs" />
      {isInUse(r) && !r.senderCustomer && (
        <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300" data-testid={`template-sender-missing-${r.code}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Gönderen yok — belgeler gönderensiz gelir
        </div>
      )}
    </div>
  );
}

/** Durum etiketi — hücre ve Excel aynı metni okur. */
const statusLabel = (r: SenderTemplateView) => (isInUse(r) ? "Aktif" : isOrphan(r) ? "Motorda yok" : "Pasif");
const kindLabel = (r: SenderTemplateView) => (isUserTemplate(r) ? "Tanıtılan" : "Hazır");

function StatusCell({ r }: { r: SenderTemplateView }) {
  if (isInUse(r)) return <Badge variant="secondary">{statusLabel(r)}</Badge>;
  if (isOrphan(r)) return <Badge variant="outline" title="Dosya şablonu okuma motorunda artık yok">{statusLabel(r)}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{statusLabel(r)}</Badge>;
}

export function belgeTipiColumns(a: BelgeTipiActions): ColumnDef<SenderTemplateView>[] {
  return [
    {
      id: "name",
      header: "Belge tipi",
      meta: { exportValue: (r: SenderTemplateView) => `${r.name} (${r.code})` },
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0" data-testid={`template-row-${r.code}`}>
          <div className="break-words font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.code}</div>
        </div>
      ),
    },
    { id: "kind", header: "Tür", meta: { exportValue: kindLabel }, cell: ({ row: { original: r } }) => kindLabel(r) },
    { id: "sender", header: "Gönderen", meta: { exportValue: (r: SenderTemplateView) => r.senderCustomer?.name ?? "" }, cell: ({ row: { original: r } }) => <SenderCell r={r} a={a} /> },
    { id: "owner", header: "Varsayılan sahip", meta: { exportValue: (r: SenderTemplateView) => r.defaultOwnerCustomer?.name ?? "" }, cell: ({ row: { original: r } }) => r.defaultOwnerCustomer?.name ?? "—" },
    { id: "version", header: "Sürüm", meta: { exportValue: (r: SenderTemplateView) => r.version }, cell: ({ row: { original: r } }) => <span className="font-mono text-xs">v{r.version}</span> },
    { id: "status", header: "Durum", meta: { exportValue: statusLabel }, cell: ({ row: { original: r } }) => <StatusCell r={r} /> },
    { id: "hitCount", header: "Okuma", meta: { exportValue: (r: SenderTemplateView) => r.hitCount }, cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.hitCount}</span> },
    { id: "updatedAt", header: "Son güncelleme", meta: { exportValue: (r: SenderTemplateView) => fmtFactoryDateTime(r.updatedAt, "") }, cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-xs">{fmtFactoryDateTime(r.updatedAt)}</span> },
    { id: "actions", header: "", enableHiding: false, cell: ({ row: { original: r } }) => <RowActions row={r} a={a} /> },
  ];
}
