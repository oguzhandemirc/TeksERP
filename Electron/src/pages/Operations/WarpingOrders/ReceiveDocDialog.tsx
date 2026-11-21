// =============================================================================
// DEVERE DÖNÜŞÜ — tek irsaliyede çok sipariş → `POST /api/warping-receive-docs` (devere ek E2, plan §7 E)
// =============================================================================
// Devereci + irsaliye no BİR KEZ; deverecinin açık siparişleri aynı ekranda kart kart, her levent satırı bir
// siparişe yerleşir (gövde okutma B3, metre, tartı `devere.receiveWeighing`e göre, yeniden sarım C1). "Önizle"
// (yazmaz) sipariş başına tek sipariş önizlemesiyle aynı; "Kabul et" hep-ya-hiç. Sipariş sayfasından açılınca
// (`fixedOrder`) tek siparişlik özel hal: devereci kilitli, o sipariş plana göre dolu, diğerleri isteğe bağlı.
// =============================================================================
import { useEffect, useRef, useState } from "react";
import { Eye, FileText, Handshake } from "lucide-react";
import { FieldGrid, FormCard, WideFormDialog } from "@/components/forms/WideFormDialog";
import { FormField } from "@/components/forms/FormField";
import { SubcontractorCategoryPicker } from "@/components/forms/SubcontractorCategoryPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEVERE_CATEGORY_CODE } from "@/lib/subcontractor-category-codes";
import { apiErrorMessage } from "@/services/apiClient";
import { fmtM } from "./order-model";
import { ReceiveDocOrderCard } from "./ReceiveDocOrderCard";
import { ReceiveDocPreviewView } from "./ReceiveDocPreview";
import { OPEN_ORDER_LIMIT, useReceiveDoc } from "./use-receive-doc";
import type { WarpingOrder } from "./types";
import type { WarpingReceiveDoc } from "./receive-doc-types";

function NoteHint({ uses, mode }: { uses: string[]; mode: "ALLOW" | "WARN" | "BLOCK" }) {
  if (uses.length === 0) return null;
  const tone = mode === "BLOCK" ? "text-destructive" : "text-amber-700 dark:text-amber-400";
  return (
    <p className={`text-xs ${tone}`} role="status">
      ! Bu irsaliye no daha önce kullanıldı: {uses.slice(0, 3).join(", ")}{uses.length > 3 ? ` ve ${uses.length - 3} kabul daha` : ""}
      {mode === "BLOCK" ? " — bu kurulumda ikinci kabul engelli." : ""}
    </p>
  );
}

export function ReceiveDocDialog({ fixedOrder, onClose, onCreated }: { fixedOrder?: WarpingOrder; onClose: () => void; onCreated?: (doc: WarpingReceiveDoc) => void }) {
  const s = useReceiveDoc(fixedOrder, (doc) => {
    onClose();
    // Diyalog (kirli form) kapandıktan SONRA gezin — açıkken sekme koruması gezinmeyi yutar.
    if (onCreated) setTimeout(() => onCreated(doc), 0);
  });
  const [showAll, setShowAll] = useState(!fixedOrder);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewKey = s.fresh ? s.preview?.key : null;
  // Önizleme kartların altında doğar; görünür alana getir (uzun belgede kullanıcı kaydırmadan görsün).
  useEffect(() => {
    if (previewKey) previewRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [previewKey]);
  const visible = showAll || !fixedOrder ? s.rows : s.rows.filter((r) => r.id === fixedOrder.id);
  const hidden = s.rows.length - visible.length;
  const options = { weighing: s.weighing, bodyMode: s.bodyMode, subcontractorId: s.sub?.id ?? null };
  const count = s.built.ok ? s.built.beamCount : 0;
  const title = fixedOrder ? `${fixedOrder.orderNo} — levent kabulü` : "Devere dönüşü — levent kabulü";

  return (
    <WideFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description="Devereci ve irsaliye no bir kez; gelen her leventi ait olduğu siparişin kartına girin. Kabul tek belgede, hep birlikte yazılır — biri reddedilirse hiçbiri yazılmaz."
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-muted-foreground">
            {s.built.ok ? `${s.built.body.orders.length} sipariş · ${count} levent · ${fmtM(s.built.totalM)} m` : "Henüz levent girilmedi"}
          </span>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" disabled={!s.body || s.pv.isPending} onClick={() => s.body && s.pv.mutate(s.body)}>
            <Eye className="mr-1 h-4 w-4" /> {s.pv.isPending ? "Önizleniyor…" : "Önizle"}
          </Button>
          <Button disabled={!s.fresh || !s.body || s.blocked || s.save.isPending} onClick={() => s.body && s.save.mutate(s.body)}>
            {s.save.isPending ? "Kaydediliyor…" : `Kabul et${s.built.ok ? ` (${count} levent)` : ""}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormCard title="İrsaliye" icon={FileText}>
          <FieldGrid cols={2}>
            <FormField label="Devereci" required>
              <SubcontractorCategoryPicker
                value={s.sub?.id ?? null}
                onChange={(id, x) => s.setSub(id ? { id, name: x?.name ?? "" } : null)}
                categoryCode={DEVERE_CATEGORY_CODE}
                queryKey="subcontractors-warping-receive-doc-picker"
                getLabel={(x) => x.name}
                icon={Handshake}
                title="Devereci seç"
                placeholder="Devereci seç"
                disabled={Boolean(fixedOrder)}
                lockedTooltip="Sipariş sayfasından açılan kabulde devereci siparişinkidir."
              />
            </FormField>
            <FormField label="Devereci irsaliye no" htmlFor="wrd-note" info="İsteğe bağlı; belgenin bütün leventlerine yazılır. Aynı no daha önce kullanıldıysa ayara göre uyarılır ya da engellenir (Ayarlar › Devere).">
              <Input id="wrd-note" maxLength={64} value={s.noteNo} onChange={(e) => s.setNoteNo(e.target.value)} placeholder="ör. DV-1200" />
              <NoteHint uses={s.priorUses} mode={s.dupMode} />
            </FormField>
          </FieldGrid>
        </FormCard>

        {!s.sub && <p className="text-sm text-muted-foreground">Önce deverecini seçin — açık siparişleri burada listelenir.</p>}
        {s.orders.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(s.orders.error)}</p>}
        {s.sub && s.orders.isSuccess && s.rows.length === 0 && <p className="text-sm text-muted-foreground">{s.sub.name} için kabul alabilecek (açık ya da sevkte) sipariş yok.</p>}
        {s.rows.length >= OPEN_ORDER_LIMIT && <p className="text-xs text-muted-foreground">İlk {OPEN_ORDER_LIMIT} açık sipariş gösteriliyor.</p>}

        {visible.map((r) => (
          <ReceiveDocOrderCard key={r.id} order={r} drafts={s.drafts[r.id] ?? []} onChange={(d) => s.setOrderDrafts(r.id, d)} options={options} />
        ))}
        {hidden > 0 && (
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
            Aynı irsaliyede başka sipariş de var ({hidden} açık sipariş daha)
          </Button>
        )}

        {!s.built.ok && s.built.error && <p className="text-sm text-destructive" role="alert">{s.built.error}</p>}
        <div ref={previewRef}>{s.fresh && s.preview && <ReceiveDocPreviewView p={s.preview.data} blocked={s.blocked} />}</div>
        {s.preview && !s.fresh && <p className="text-sm text-muted-foreground">Girdi değişti — kabul etmeden önce yeniden önizleyin.</p>}
      </div>
    </WideFormDialog>
  );
}
