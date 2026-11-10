import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Pencil, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { labelTextsFixBody, labelTextsLockReason, labelTextsService } from "./labelTextsService";
import type { Roll } from "./types";

interface Props {
  roll: Roll;
  /** Başarılı düzeltmeden sonra detay tazelenir. */
  onSaved?: () => void;
  /** false: değerler başka yerde (top kartı "Top bilgileri" tablosu) — kart yalnız Düzelt şeridi; yazma izni yoksa çizilmez. */
  showValues?: boolean;
}

/**
 * Etikete basılan müşteri kumaş adı / renk / parti no (tamburda topa yazılır) — top sevk edilene
 * kadar düzeltilir (`PATCH /api/rolls/:id/label-texts`, sebep zorunlu). Boş alan = kumaşın kendi
 * adı/rengi basılır. Yeniden baskı mevcut "Etiket" düğmesinden yapılır.
 */
export function RollLabelTextsCard({ roll, onSaved, showValues = true }: Props) {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("roll:write") || hasPermission("label:edit");
  const lock = labelTextsLockReason(roll.status);
  const [open, setOpen] = useState(false);
  if (!showValues && !canWrite) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Etikete basılan</span>
          <div className="flex-1" />
          {canWrite && (
            <Button
              type="button"
              size="sm"
              className="gap-1"
              disabled={!!lock}
              title={lock ?? undefined}
              onClick={() => setOpen(true)}
              data-testid="etiket-bilgisi-duzelt"
            >
              <Pencil className="h-3.5 w-3.5" /> Düzelt
            </Button>
          )}
        </div>
        {showValues && <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="text-xs text-muted-foreground">Kumaş adı</div>
          <div>{roll.labelItemName ?? <span className="text-muted-foreground">Kendi adı ({roll.item?.name ?? "—"})</span>}</div>
          <div className="text-xs text-muted-foreground">Renk</div>
          <div>{roll.labelColorName ?? <span className="text-muted-foreground">Kendi rengi ({roll.color?.name ?? "—"})</span>}</div>
          <div className="text-xs text-muted-foreground">Müşteri parti</div>
          <div>{roll.labelBatchNo ?? <span className="text-muted-foreground">—</span>}</div>
        </div>}
        <LabelEditMark roll={roll} />
        {canWrite && lock && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="etiket-bilgisi-kilit">
            <Lock className="h-3 w-3" /> {lock}
          </p>
        )}
      </CardContent>
      <RollLabelTextsDialog roll={open ? roll : null} onOpenChange={setOpen} onSaved={onSaved} />
    </Card>
  );
}

export function RollLabelTextsDialog({
  roll,
  onOpenChange,
  onSaved,
}: {
  roll: Roll | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const open = Boolean(roll);
  const qc = useQueryClient();
  const [itemName, setItemName] = useState("");
  const [colorName, setColorName] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!roll) return;
    setItemName(roll.labelItemName ?? "");
    setColorName(roll.labelColorName ?? "");
    setBatchNo(roll.labelBatchNo ?? "");
    setReason("");
  }, [roll]);

  const body = roll ? labelTextsFixBody(roll, { itemName, colorName, batchNo }) : {};
  const hasChange = Object.keys(body).length > 0;
  // onError YOK: apiClient interceptor'ı 409 (sevk edildi / kapanmış / değişti) mesajını basar.
  const mutation = useMutation({
    mutationFn: () => labelTextsService.fix(roll!.id, { ...body, reason: reason.trim() }),
    onSuccess: (res) => {
      toast.success(res.data?.changed ? "Etiket bilgisi düzeltildi — etiketi yeniden basmayı unutma." : "Etiket bilgisi zaten aynı.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onSaved?.();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="h-4 w-4" /> Etiket bilgisini düzelt</DialogTitle>
          <DialogDescription>
            Yalnız bu topun etiketine basılan ad/renk/parti değişir; kumaşın kendi kaydı değişmez. Boş bırakılan
            alanda kumaşın kendi adı/rengi basılır. Kaydettikten sonra etiketi yeniden basın.
          </DialogDescription>
        </DialogHeader>
        {roll && (
          <div className="space-y-3">
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              <span className="font-mono">{roll.barcode ?? "Açık kumaş"}</span> · {roll.item?.name ?? "—"}
              {roll.color?.name ? ` · ${roll.color.name}` : ""}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-item">Kumaş adı</Label>
              <Input id="lt-item" maxLength={80} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder={`Boş: ${roll.item?.name ?? "kumaşın kendi adı"}`} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-color">Renk</Label>
              <Input id="lt-color" maxLength={80} value={colorName} onChange={(e) => setColorName(e.target.value)} placeholder={`Boş: ${roll.color?.name ?? "kumaşın kendi rengi"}`} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-batch">Müşteri parti no</Label>
              <Input id="lt-batch" maxLength={64} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Boş: basılmaz" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-reason">Düzeltme sebebi (zorunlu)</Label>
              <Textarea id="lt-reason" maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. müşteri adı yanlış söylendi" />
            </div>
            {!hasChange && <p className="text-xs text-muted-foreground">Değişiklik yok.</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={!hasChange || reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()} data-testid="etiket-bilgisi-kaydet">
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Etiketi düzenle" izi: elle yazılmış alan sayısı ve bir seferlik şablon (basım her yüzeyde bunu uygular). */
function LabelEditMark({ roll }: { roll: Roll }) {
  const n = Object.keys(roll.labelOverrides ?? {}).length;
  if (n === 0 && !roll.labelTemplate) return null;
  return (
    <p className="text-xs text-sky-700 dark:text-sky-400" data-testid="etiket-elle-duzenlendi">
      Etikette elle düzenlendi{n > 0 ? ` (${n} alan)` : ""}
      {roll.labelTemplate ? ` · şablon: ${roll.labelTemplate.name}` : ""}
    </p>
  );
}
