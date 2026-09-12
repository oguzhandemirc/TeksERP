import { useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { mergeService, type MergeEntity, type MergeOperationRow, type UnmergePlan } from "@/services/mergeService";

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" });
export const MERGES_KEY = ["master-data", "merges"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: MergeEntity;
}

/**
 * BİRLEŞTİRME GEÇMİŞİ + GERİ ALMA. Birleştirme artık deftere yazıldığı için geri
 * alınabilir; geri alma SIRALIDIR (aynı kayıtlar sonra yeniden birleştirildiyse
 * önce o geri alınır) ve adlar çakışıyorsa yeni ad ister — ikisini de backend
 * önizlemesi söyler, bu ekran yalnız gösterir ve sorar.
 */
export function MergeHistoryDialog({ open, onOpenChange, entity }: Props) {
  const q = useQuery({
    queryKey: [...MERGES_KEY, entity],
    queryFn: () => mergeService.merges(entity, 50),
    enabled: open,
  });
  const rows = q.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Birleştirme Geçmişi
          </DialogTitle>
          <DialogDescription>
            Her birleştirme deftere yazılır: hangi satır hangi kayıttan taşındı, hangi çakışma
            satırı silindi. Geri alma bu defterden okur; defter öncesi birleştirmeler geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {q.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>
          ) : q.isError && rows.length === 0 ? (
            <div className="space-y-2 py-8 text-center text-sm text-destructive">
              <p>Geçmiş yüklenemedi — bu “geri alınamaz” cevabı DEĞİLDİR.</p>
              <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Bu varlıkta defterli birleştirme yok.
            </div>
          ) : (
            rows.map((r) => <OperationRow key={r.id} row={r} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OperationRow({ row }: { row: MergeOperationRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          <b>{row.sourceCount}</b> kayıt birleşti · {row.movedRows} referans taşındı
        </span>
        {row.revertedAt ? (
          <Badge variant="secondary">Geri alındı</Badge>
        ) : (
          <Button variant="outline" size="sm" className="h-7 gap-1" disabled={open} onClick={() => setOpen(true)}>
            <Undo2 className="h-3.5 w-3.5" /> Geri al
          </Button>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {DATE_FMT.format(new Date(row.createdAt))} · {row.reason}
      </div>
      {row.revertedAt && (
        <div className="text-xs text-muted-foreground">
          Geri alma: {DATE_FMT.format(new Date(row.revertedAt))} · {row.revertReason}
        </div>
      )}
      {open && <RevertForm row={row} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** 409 gövdesindeki engeller — backend plan metinleri aynen basılır. */
function blockersOf(error: unknown): string[] {
  if (!axios.isAxiosError(error)) return [];
  const d = (error.response?.data as { details?: { blockers?: unknown } } | undefined)?.details;
  return Array.isArray(d?.blockers) ? d.blockers.filter((b): b is string => typeof b === "string") : [];
}

/** Planın satır dökümü + engeller — yalnız gösterir (karar backend'de). */
function RevertPlanBody({ plan }: { plan: UnmergePlan }) {
  return (
    <>
      {plan.blockers.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-destructive">
          {plan.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 text-xs">
        {plan.refs.map((r) => (
          <li key={`${r.tableName}.${r.columnName}.${r.kind}`} className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {r.tableName}.{r.columnName} ·{" "}
              {r.kind === "MOVED" ? "taşınan" : r.kind === "DELETED" ? "silinen" : "alan"}
            </span>
            <span>{r.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Ad çakışan kaynaklar için yeni ad alanları (çakışma KULLANICI kararıdır). */
function RenameInputs({
  sources,
  renames,
  onChange,
}: {
  sources: UnmergePlan["sources"];
  renames: Record<string, string>;
  onChange: (sourceId: string, value: string) => void;
}) {
  return (
    <>
      {sources.map((s) => (
        <div key={s.sourceId} className="space-y-1">
          <p className="text-xs text-destructive">
            “{s.nameBefore}” adı “{s.collidesWith}” ile çakışıyor — yeni ad gerekli.
          </p>
          <Input
            className="h-8 text-xs"
            placeholder="Kaynak kaydın yeni adı"
            value={renames[s.sourceId] ?? ""}
            onChange={(e) => onChange(s.sourceId, e.target.value)}
          />
        </div>
      ))}
    </>
  );
}

function RevertForm({ row, onClose }: { row: MergeOperationRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const preview = useQuery({
    queryKey: [...MERGES_KEY, row.id, "revert-preview"],
    queryFn: () => mergeService.revertPreview(row.id),
  });
  const plan = preview.data?.data;
  const needRename = (plan?.sources ?? []).filter((s) => s.needsRename);
  const renameReady = needRename.every((s) => (renames[s.sourceId]?.trim().length ?? 0) > 0);
  const blocked = !plan || plan.blockers.length > 0;

  const mut = useMutation({
    mutationFn: () => mergeService.revert(row.id, { reason: reason.trim(), renames }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Birleştirme geri alındı");
      onClose();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MERGES_KEY });
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
      void qc.invalidateQueries({ queryKey: ["master-data"] });
    },
  });

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      {preview.isLoading ? (
        <p className="text-xs text-muted-foreground">Önizleme yükleniyor…</p>
      ) : preview.isError ? (
        <p className="text-xs text-destructive">Önizleme yüklenemedi — tekrar deneyin.</p>
      ) : plan ? (
        <>
          <RevertPlanBody plan={plan} />
          <RenameInputs
            sources={needRename}
            renames={renames}
            onChange={(id, v) => setRenames((p) => ({ ...p, [id]: v }))}
          />
        </>
      ) : null}
      <Textarea
        rows={2}
        maxLength={500}
        className="text-xs"
        placeholder="Geri alma gerekçesi (en az 10 karakter)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mut.isError && blockersOf(mut.error).length > 0 && (
        <ul className="list-disc pl-5 text-xs text-destructive">
          {blockersOf(mut.error).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={mut.isPending}>
          Vazgeç
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={blocked || !renameReady || reason.trim().length < 10 || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? "Geri alınıyor…" : "Birleştirmeyi geri al"}
        </Button>
      </div>
    </div>
  );
}
