// =============================================================================
// KOŞUMU GERİ SAR — etkilenen HER satır listelenir, seçim satır bazlıdır
// =============================================================================
// Yıkıcı işlem kuralı: soyut sayı YETMEZ. Önizleme her satırı kendi işlemiyle
// gösterir, atlanacaklar GEREKÇESİYLE görünür (tek "atlandı" kovası yok) ve yan
// etkiler "kalacak" diye ayrı bölümde durur — geri sarma başka varlığın ana
// verisini silmez. Sözleşme: docs/design/IMPORT-EXPORT-TASARIM.md §8.5.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { importService, type ImportRevertPlan, type ImportRevertPlanRow } from "@/services/importService";
// `ImportLineAction` değerlerinin Türkçesi audit sözlüğünde YAŞIYOR (tek sözlük):
// ikinci bir etiket haritası açmak iki sözlüğü kaçınılmaz olarak drift ettirir.
import { enumValueLabel } from "@/lib/audit-labels";

interface Props {
  runId: string;
  onOpenChange: (open: boolean) => void;
  onReverted: () => void;
}

/** Planın YAPILACAK İŞ etiketleri — panel kavramı (Prisma enum'u değil). */
const ACTION_LABELS: Record<ImportRevertPlanRow["action"], string> = {
  DEACTIVATE: "Pasife alınacak",
  RESTORE_FIELDS: "Alanlar eski değerine dönecek",
  RESTORE_CHILDREN: "Alt liste eski haline dönecek",
  CANCEL_DOCUMENT: "Belge iptal edilecek",
  DELETE_PIVOT: "Satır silinecek",
  SKIP: "Atlanacak",
};

const isSelectable = (r: ImportRevertPlanRow): boolean => r.action !== "SKIP" && !r.alreadyReverted;

export function ImportRevertDialog({ runId, onOpenChange, onReverted }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<Set<number> | null>(null);

  const preview = useQuery({
    queryKey: ["import-runs", runId, "revert-preview"],
    queryFn: () => importService.revertPreview(runId).then((r) => r.data),
  });
  const plan = preview.data;
  // İlk yüklemede uygulanabilir satırların TAMAMI seçili başlar; kullanıcı daraltır.
  const selected = picked ?? new Set((plan?.rows ?? []).filter(isSelectable).map((r) => r.rowNo));

  const revertM = useMutation({
    mutationFn: () =>
      importService.revertRun(runId, { reason: reason.trim(), selectedRowNos: [...selected] }),
    onSuccess: (res) => {
      const d = res.data;
      toast.success(`${d.reverted} satır geri sarıldı.`);
      // Atlananlar GEREKÇESİYLE basılır: "12 satır atlandı" özeti kullanıcıya
      // hangi kaydın neden kaldığını söylemez.
      if (d.skipped.length > 0) {
        toast.warning(
          `${d.skipped.length} satır atlandı:\n` +
            d.skipped.map((s) => `• Satır ${s.rowNo}: ${s.reason}`).join("\n"),
          { duration: 12000 },
        );
      }
      void qc.invalidateQueries({ queryKey: ["import-runs"] });
      onOpenChange(false);
      onReverted();
    },
  });

  const applicable = (plan?.rows ?? []).filter(isSelectable).length;
  const blocked = preview.isLoading || applicable === 0 || selected.size === 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Koşum geri sarılsın mı?</DialogTitle>
          <DialogDescription>
            Koşum kaydı SİLİNMEZ: üstüne geri sarma damgası yazılır, defter satırları yerinde
            kalır. Yaratılan kayıtlar pasife alınır, güncellenenler yalnız içe aktarımın
            DOKUNDUĞU alanlarda eski değerine döner.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <p className="text-sm text-muted-foreground">Plan yükleniyor…</p>
        ) : preview.isError ? (
          <PreviewError onRetry={() => void preview.refetch()} />
        ) : plan ? (
          <PlanBody plan={plan} selected={selected} onToggle={(rowNo, on) => {
            const next = new Set(selected);
            if (on) next.add(rowNo);
            else next.delete(rowNo);
            setPicked(next);
          }} />
        ) : null}

        <ReasonField value={reason} onChange={setReason} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={blocked || reason.trim().length < 10 || revertM.isPending}
            onClick={() => revertM.mutate()}
          >
            {revertM.isPending ? "Geri sarılıyor…" : `${selected.size} satırı geri sar`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ⚠️ "Geri sarılamaz" CEVABI DEĞİL: istek düştü. Sessiz kalsa düğme gerekçesiz disabled görünürdü. */
function PreviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
      <p>Plan yüklenemedi — bu bir “geri sarılamaz” cevabı DEĞİLDİR, istek tamamlanmadı.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tekrar dene
      </Button>
    </div>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label htmlFor="imp-revert-reason">Geri sarma gerekçesi</Label>
      <Textarea
        id="imp-revert-reason"
        className="mt-1"
        rows={2}
        maxLength={500}
        placeholder="Örn. yanlış dosya yüklendi, kodlar müşterinin eski listesinden."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        En az 10 karakter — gerekçe koşum kaydında kalır.
      </p>
    </div>
  );
}

function PlanBody({
  plan,
  selected,
  onToggle,
}: {
  plan: ImportRevertPlan;
  selected: Set<number>;
  onToggle: (rowNo: number, on: boolean) => void;
}) {
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
      <p className="text-muted-foreground">
        <b>{plan.entityLabel}</b> · {plan.rows.length} satır
        {plan.runRevertedAt ? " · bu koşum daha önce geri sarılmış" : ""}
      </p>

      <ul className="space-y-1">
        {plan.rows.map((r) => {
          const enabled = isSelectable(r);
          return (
            <li key={r.lineId} className="flex flex-wrap items-center gap-x-3 rounded border px-2 py-1">
              <Checkbox
                checked={selected.has(r.rowNo)}
                disabled={!enabled}
                onCheckedChange={(v) => onToggle(r.rowNo, v === true)}
                aria-label={`Satır ${r.rowNo}`}
              />
              <span className="text-muted-foreground tabular-nums">
                satır {r.rowNos?.length ? r.rowNos.join(",") : r.rowNo}
              </span>
              <span className="font-mono">{r.keyValue ?? "—"}</span>
              <span className="flex-1">{r.label ?? ""}</span>
              <span className="text-muted-foreground">{enumValueLabel(r.lineAction)}</span>
              {r.skipReason ? (
                <span className="text-destructive">{r.skipReason}</span>
              ) : (
                <span>
                  {ACTION_LABELS[r.action]}
                  {r.fields.length > 0 ? ` (${r.fields.join(", ")})` : ""}
                  {r.children.length > 0 ? ` + ${r.children.join(", ")}` : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {plan.sideEffects.length > 0 && (
        <section className="rounded-md border border-warning/40 p-3">
          <h3 className="mb-1 font-semibold">Bunlar KALACAK</h3>
          <ul className="list-disc pl-5 text-muted-foreground">
            {plan.sideEffects.map((s) => (
              <li key={s.rowNo}>
                Satır {s.rowNo}: {s.note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
