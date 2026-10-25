import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Info, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/services/apiClient";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import { deviceKindLabel } from "./DeviceRow";
import { CONFIDENCE_LABEL, MERGE_CANDIDATES_QUERY_KEY, defaultMergeSelection } from "./merge";
import type { MergeCandidateGroup, MergeCandidateMember, MergePreviewSource } from "./types";

export const MERGE_UNDO_NOTE = "Geri alınabilir; taşınan donanım bağları geri taşınmaz.";

const fmt = (iso: string | null) => (iso ? safeFormat(iso, "dd.MM.yyyy HH:mm") : "—");

function ConfidenceBadge({ level }: { level: MergeCandidateMember["confidence"] }) {
  const cls =
    level === "HIGH"
      ? "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : level === "MEDIUM"
        ? "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
        : "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return <Badge className={cls}>güven: {CONFIDENCE_LABEL[level]}</Badge>;
}

function SourcePreviewDetails({ preview }: { preview: MergePreviewSource | undefined }) {
  if (preview === undefined) return <Skeleton className="h-4 w-2/3" />;
  const openSession = preview.blockers.some((b) => b.code === "DEVICE_MERGE_OPEN_SESSION");
  const moving = preview.hardwareLinks.filter((l) => !l.alreadyOnTarget).length + preview.legacyPeripherals.length;
  return (
    <>
      <div className="text-xs">
        <strong>{preview.workSessions.count}</strong> iş oturumu YERİNDE KALIR · <strong>{moving}</strong> donanım bağı
        taşınır · {openSession ? "açık oturum VAR" : "açık oturum yok"}
      </div>
      {preview.blockers.map((b) => (
        <div key={b.code} className="text-xs font-medium text-destructive" role="note">
          Seçilemez: {b.message}
        </div>
      ))}
      {preview.notes.map((n) => (
        <div key={n} className="text-xs text-muted-foreground">
          · {n}
        </div>
      ))}
      {preview.hardwareLinks.length + preview.legacyPeripherals.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Donanım: {[...preview.hardwareLinks, ...preview.legacyPeripherals].map((p) => p.name).join(", ")}
        </div>
      )}
      {preview.workSessions.recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Son {preview.workSessions.recent.length} oturum</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {preview.workSessions.recent.map((s) => (
              <li key={s.id}>
                {fmt(s.startedAt)} · {s.user?.fullName || s.user?.username || "—"} · {s.station?.name ?? "—"}
                {s.machine ? ` · ${s.machine.code}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function SourceRow({
  member,
  preview,
  checked,
  onToggle,
}: {
  member: MergeCandidateMember;
  preview: MergePreviewSource | undefined;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const inputId = `merge-src-${member.id}`;
  return (
    <li className="flex gap-3 py-3" data-testid={`merge-source-${member.id}`}>
      <div className="pt-0.5">
        {blocked ? (
          <Lock className="h-4 w-4 text-muted-foreground" aria-label="Seçilemez" />
        ) : (
          <Checkbox id={inputId} checked={checked} onCheckedChange={(v) => onToggle(v === true)} aria-label={`${member.name} kaydını seç`} />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={inputId} className="font-medium break-all">
            {member.name}
          </label>
          <span className="font-mono text-xs text-muted-foreground">{member.deviceId.slice(0, 8)}</span>
          <ConfidenceBadge level={member.confidence} />
          {!member.isActive && <Badge variant="muted">Pasif</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {fmt(member.createdAt)} → {fmt(member.lastSeenAt)}
          {member.reasons.length > 0 && <> · {member.reasons.join(" · ")}</>}
        </div>
        {member.warnings.map((w) => (
          <div key={w} className="flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{w}</span>
          </div>
        ))}
        <SourcePreviewDetails preview={preview} />
      </div>
    </li>
  );
}

/** Seçim durumu: önizleme gelince varsayılana döner (düşük güven ve engelli kaynak seçili değil). */
function useMergeSelection(group: MergeCandidateGroup | null, preview: MergePreviewSource[] | undefined) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (group) setSelected(defaultMergeSelection(group, preview));
  }, [group, preview]);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return [selected, toggle] as const;
}

/**
 * Birleştirme önizlemesi (D4): hedef önerilen ana kayıt; kaynaklar kayıt kayıt onay kutusuyla.
 * Düşük güven VARSAYILAN SEÇİLİ DEĞİL; engelli kaynak seçilemez (neden yazılı). İş oturumları taşınmaz.
 */
export function MergeDialog({ group, onClose }: { group: MergeCandidateGroup | null; onClose: () => void }) {
  const qc = useQueryClient();
  const allIds = group?.sources.map((s) => s.id) ?? [];
  const preview = useQuery({
    queryKey: ["admin-device-merge-preview", group?.target.id, allIds.join(",")],
    queryFn: () => deviceService.mergePreview(group!.target.id, allIds),
    enabled: group !== null && allIds.length > 0,
    retry: false,
    staleTime: 0,
  });
  const previewSources = preview.data?.sources;
  const [selected, toggle] = useMergeSelection(group, previewSources);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [MERGE_CANDIDATES_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["admin-devices"] });
  };
  const merge = useMutation({
    mutationFn: () => deviceService.merge(group!.target.id, [...selected]),
    onSuccess: (r) => {
      toast.success(`${r.merged.length} kayıt "${r.target.name}" kaydına birleştirildi`);
      refresh();
      onClose();
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek suppressErrorToast taşır; tek toast burası
      toast.error(apiErrorMessage(e, "Birleştirme yapılamadı"));
      void preview.refetch();
      refresh();
    },
  });

  const targetBlocked = (preview.data?.targetBlockers.length ?? 0) > 0;
  const n = selected.size;
  const byId = new Map((previewSources ?? []).map((s) => [s.id, s]));

  return (
    <Dialog open={group !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Birleştirme önizlemesi — hedef: {group?.target.name}</DialogTitle>
          <DialogDescription>
            {group ? `${deviceKindLabel(group.kind)} · ana kayıt son görülme ${fmt(group.target.lastSeenAt)}. ` : ""}
            Seçtiğiniz kayıtlar ana kayda bağlanır ve pasif olur. İş oturumları ve geçmiş kayıtlar yerinde kalır, raporlar
            ana kayıt adıyla görünür.
          </DialogDescription>
        </DialogHeader>

        {preview.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(preview.error, "Önizleme alınamadı")}</p>
        )}
        {preview.data?.targetBlockers.map((b) => (
          <p key={b.code} className="text-sm font-medium text-destructive">
            {b.message}
          </p>
        ))}

        <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto px-1">
          {group?.sources.map((m) => (
            <SourceRow
              key={m.id}
              member={m}
              preview={byId.get(m.id)}
              checked={selected.has(m.id)}
              onToggle={(v) => toggle(m.id, v)}
            />
          ))}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {MERGE_UNDO_NOTE}
          </p>
          <div className="flex gap-2 self-end">
            <Button variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button onClick={() => merge.mutate()} disabled={n === 0 || targetBlocked || !preview.data || merge.isPending}>
              {n} kaydı birleştir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
