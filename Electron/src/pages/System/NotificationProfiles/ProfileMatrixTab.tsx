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
import { useKindBrowse } from "./group-collapse";
import { KindGroupHeader, KindSearchBar } from "./KindGroupParts";
import { LockPreviewDialog } from "./LockPreviewDialog";
import { PresetFillMenu } from "./PresetFillMenu";
import {
  CELL_LABEL,
  SUMMARY_LABEL,
  allowsOff,
  cellsFromDraft,
  draftEquals,
  draftFromCells,
  fillFromPreset,
  matrixBulk,
  membersAfterLockChoice,
  needsLockPreview,
  stateSummary,
  type CellDraft,
} from "./model";
import { PROFILES_QUERY_ROOT } from "./queries";

const STATES: ProfileCellState[] = ["ACIK", "KAPALI", "KILITLI"];
const SUMMARY_ORDER = ["ACIK", "KAPALI", "KILITLI", "BOS"] as const;

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

  const { query, setQuery, searching, groups, shown, isOpen, toggle, foldAll } = useKindBrowse(kinds, "matris");
  return (
    <>
      {readOnly && (
        <ListMessage className="shrink-0 border-b py-2 sm:py-2">
          <p className="text-sm text-muted-foreground">Arşivlenmiş profil — matris salt okunur, çözüme katılmaz.</p>
        </ListMessage>
      )}
      <KindSearchBar className="shrink-0 border-b px-3 py-1.5" query={query} onQuery={setQuery} shown={shown} total={kinds.length} onFoldAll={foldAll} />
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
            <MatrixGroup
              key={g.grup}
              grup={g.grup}
              items={g.items}
              draft={draft}
              blind={profile.izinsizUyeler ?? {}}
              readOnly={readOnly}
              open={isOpen(g.grup)}
              filtered={searching}
              onToggle={() => toggle(g.grup)}
              onBulk={(to) => setDraft((d) => matrixBulk(d, g.items, to))}
              onSet={set}
            />
          ))}
        </table>
        {searching && groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">“{query.trim()}” ile eşleşen bildirim türü yok.</p>}
      </ListBody>
      <ListFooter loaded={kinds.length} label={dirty ? "Kaydedilmemiş değişiklik var." : `${kinds.length} bildirim türü`}>
        {!readOnly && (
          <>
            <PresetFillMenu
              disabled={save.isPending}
              onFill={(p) => {
                setDraft((d) => fillFromPreset(d, kinds, p.turler));
                toast(`“${p.ad}” kümesiyle dolduruldu; kaydetmeyi unutmayın.`);
              }}
            />
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

interface GroupProps {
  grup: string;
  items: readonly FactoryDefaultKind[];
  draft: CellDraft;
  blind: Readonly<Record<string, number>>;
  readOnly: boolean;
  open: boolean;
  filtered: boolean;
  onToggle: () => void;
  onBulk: (to: "ACIK" | "KAPALI") => void;
  onSet: (tur: string, v: ProfileCellState | null) => void;
}

/** Katlanır grup gövdesi: başlık satırı her zaman, tür satırları yalnız açıkken. */
function MatrixGroup({ grup, items, draft, blind, readOnly, open, filtered, onToggle, onBulk, onSet }: GroupProps) {
  const bodyId = `matris-grup-${grup}`;
  return (
    <tbody id={bodyId}>
      <tr className="border-t bg-muted/20">
        <th colSpan={5} className="p-0 text-left font-normal">
          <KindGroupHeader
            grup={grup}
            count={items.length}
            summary={stateSummary(items.map((k) => draft[k.tur] ?? "BOS"), SUMMARY_ORDER, SUMMARY_LABEL)}
            open={open}
            onToggle={onToggle}
            onBulk={readOnly ? undefined : onBulk}
            filtered={filtered}
            controls={bodyId}
          />
        </th>
      </tr>
      {open && items.map((k) => (
        <MatrixRow key={k.tur} kind={k} value={draft[k.tur]} blind={blind[k.tur] ?? 0} readOnly={readOnly} onSet={(v) => onSet(k.tur, v)} />
      ))}
    </tbody>
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
      <td className="whitespace-nowrap px-3 py-1.5">
        {/* Liste standardı: tek satır — izin uyarısı adın yanında, satırı büyütmez. */}
        <div className="flex items-center gap-1.5">
          <span>{k.ad}</span>
          {k.kilit === "HER_ZAMAN" && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Katalogda her zaman kilitli" />}
          {blind > 0 && (
            <span className="ml-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title={`Bu türü ${blind} üye alamaz: izinleri yok`}>
              <AlertTriangle className="h-3 w-3 shrink-0" /> Bu türü {blind} üye alamaz: izinleri yok
            </span>
          )}
        </div>
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
