// Matris sekmesi (plan §6.5): satır = tür (grup başlıklı), hücre üç durumlu. "Kaydet" yalnız BU profilin
// hücrelerini replace eder; taslakta kilit varsa önce kilit önizlemesi (ezilecek tercihler) gösterilir.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eraser, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import {
  bildirimProfilService,
  type FactoryDefaultKind,
  type LockPreviewAffected,
  type NotificationProfile,
  type ProfileCellState,
} from "@/services/bildirimProfilService";
import { cn } from "@/lib/utils";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { LockPreviewDialog } from "./LockPreviewDialog";
import {
  CELL_LABEL,
  allowsOff,
  cellsFromDraft,
  draftEquals,
  draftFromCells,
  groupKinds,
  membersAfterLockChoice,
  needsLockPreview,
  type CellDraft,
} from "./model";
import { PROFILES_QUERY_ROOT } from "./queries";

const STATES: ProfileCellState[] = ["ACIK", "KAPALI", "KILITLI"];

interface Props {
  profile: NotificationProfile;
  kinds: readonly FactoryDefaultKind[];
}

export function ProfileMatrixTab({ profile, kinds }: Props) {
  const readOnly = profile.arsivlendi !== null;
  const base = useMemo(() => draftFromCells(profile.hucreler), [profile.hucreler]);
  const [draft, setDraft] = useState<CellDraft>(base);
  useEffect(() => setDraft(base), [base]);
  const dirty = !draftEquals(draft, base);
  const { preview, setPreview, save, lookup, onSave, onPreview } = useMatrixSave(profile, draft);

  const set = (tur: string, s: ProfileCellState | null) =>
    setDraft((d) => {
      const n = { ...d };
      if (s === null) delete n[tur];
      else n[tur] = s;
      return n;
    });

  const groups = groupKinds(kinds);
  return (
    <>
      {readOnly && (
        <ListMessage className="shrink-0 border-b py-2 sm:py-2">
          <p className="text-sm text-muted-foreground">Arşivlenmiş profil — matris salt okunur, çözüme katılmaz.</p>
        </ListMessage>
      )}
      <ListBody>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tür</th>
              {STATES.map((s) => (
                <th key={s} className="w-20 px-2 py-2 text-center font-medium">{CELL_LABEL[s]}</th>
              ))}
              <th className="w-10" aria-label="Temizle" />
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.grup}>
              <tr className="bg-muted/20">
                <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.grup}</th>
              </tr>
              {g.items.map((k) => (
                <MatrixRow key={k.tur} kind={k} value={draft[k.tur]} blind={profile.izinsizUyeler?.[k.tur] ?? 0} readOnly={readOnly} onSet={(v) => set(k.tur, v)} />
              ))}
            </tbody>
          ))}
        </table>
      </ListBody>
      <ListFooter loaded={kinds.length} label={dirty ? "Kaydedilmemiş değişiklik var." : `${kinds.length} bildirim türü`}>
        {!readOnly && (
          <>
            <Button size="sm" variant="outline" disabled={lookup.isPending} onClick={() => void onPreview()}>Kilit önizlemesi</Button>
            <Button size="sm" disabled={!dirty || save.isPending || lookup.isPending} onClick={() => void onSave()}>Kaydet</Button>
          </>
        )}
      </ListFooter>
      <LockPreviewDialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
        affected={preview?.affected ?? []}
        readOnly={!preview?.forSave}
        pending={save.isPending}
        onConfirm={(kept) => save.mutate(kept)}
      />
    </>
  );
}

interface RowProps {
  kind: FactoryDefaultKind;
  value: ProfileCellState | undefined;
  blind: number;
  readOnly: boolean;
  onSet: (v: ProfileCellState | null) => void;
}

function MatrixRow({ kind: k, value: v, blind, readOnly, onSet }: RowProps) {
  return (
    <tr className="border-t" data-testid={`matris-${k.tur}`}>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span>{k.ad}</span>
          {k.kilit === "HER_ZAMAN" && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Katalogda her zaman kilitli" />}
        </div>
        {blind > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Bu türü {blind} üye alamaz: izinleri yok
          </div>
        )}
      </td>
      {STATES.map((s) => {
        const off = s === "KAPALI" && !allowsOff(k.kilit);
        return (
          <td key={s} className="px-2 py-1.5 text-center">
            <input
              type="radio"
              name={`hucre-${k.tur}`}
              aria-label={`${k.ad}: ${CELL_LABEL[s]}`}
              className={cn("h-4 w-4 accent-primary", (readOnly || off) && "cursor-not-allowed")}
              checked={v === s}
              disabled={readOnly || off}
              title={off ? "Katalogda her zaman kilitli tür kapatılamaz" : undefined}
              onChange={() => onSet(s)}
            />
          </td>
        );
      })}
      <td className="px-1 text-center">
        {v && !readOnly && (
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" title="Profilden çıkar (katmana katılmaz)" aria-label={`${k.ad}: temizle`} onClick={() => onSet(null)}>
            <Eraser className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

/** Kaydet akışı: taslakta kilit + üye varsa önce önizleme; seçilmeyen kişiler profilden çıkar, sonra hücreler yazılır. */
function useMatrixSave(profile: NotificationProfile, draft: CellDraft) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{ affected: LockPreviewAffected[]; forSave: boolean } | null>(null);

  const save = useMutation({
    mutationFn: async (kept: Set<string> | null) => {
      const members = profile.uyeler.map((u) => u.userId);
      if (kept && preview) {
        const next = membersAfterLockChoice(members, preview.affected.map((a) => a.userId), kept);
        if (next.length !== members.length) await bildirimProfilService.uyeleriYaz(profile.id, next);
      }
      return bildirimProfilService.hucreleriYaz(profile.id, cellsFromDraft(draft));
    },
    onSuccess: () => {
      setPreview(null);
      toast.success("Profil matrisi kaydedildi.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const lookup = useMutation({
    mutationFn: () => bildirimProfilService.kilitOnizleme(profile.id, cellsFromDraft(draft)),
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const onSave = async () => {
    if (!needsLockPreview(draft, profile.uyeler.length)) return save.mutate(null);
    const r = await lookup.mutateAsync();
    if (r.etkilenen.length === 0) return save.mutate(null);
    setPreview({ affected: r.etkilenen, forSave: true });
  };
  const onPreview = async () => {
    const r = await lookup.mutateAsync();
    setPreview({ affected: r.etkilenen, forSave: false });
  };

  return { preview, setPreview, save, lookup, onSave, onPreview };
}
