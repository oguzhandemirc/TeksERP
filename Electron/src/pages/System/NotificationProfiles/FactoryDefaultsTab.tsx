// Fabrika varsayılanı (plan §5.1 ikinci katman): tür başına Miras/Açık/Kapalı/Kilitli + eşikler + ek alıcılar.
// "Kaydet" yalnız DEĞİŞEN türleri gönderir; eşik doğrulamasının son sözü sunucudadır (katalog şeması).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimProfilService, type FactoryDefaultKind, type FactoryDefaultState } from "@/services/bildirimProfilService";
import { cn } from "@/lib/utils";
import { FACTORY_LABEL, allowsOff, factoryChanges, factoryDraftFrom, groupKinds, type FactoryDraftRow } from "./model";
import { candidatesKey, PROFILES_QUERY_ROOT } from "./queries";
import { UserPickerDialog } from "./UserPickerDialog";

const STATES: FactoryDefaultState[] = ["MIRAS", "ACIK", "KAPALI", "KILITLI"];
// Katalog `paramSemasi` alan adları → görünen ad (bilinmeyen alan adıyla görünür, sessizce kaybolmaz).
const ESIK_LABEL: Record<string, string> = {
  gun: "Eşik (gün)",
  kalanGun: "Kalan gün eşiği",
  dakika: "Eşik (dakika)",
  oranYuzde: "Oran eşiği (%)",
  minMetre: "En az metre",
};

export function FactoryDefaultsTab({ kinds }: { kinds: readonly FactoryDefaultKind[] }) {
  const qc = useQueryClient();
  const base = useMemo(() => factoryDraftFrom(kinds), [kinds]);
  const [draft, setDraft] = useState<Record<string, FactoryDraftRow>>(base);
  useEffect(() => setDraft(base), [base]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const candidates = useQuery({ queryKey: candidatesKey, queryFn: () => bildirimProfilService.adaylar(), staleTime: 60_000 });
  const names = useMemo(() => new Map((candidates.data?.items ?? []).map((c) => [c.id, c.ad])), [candidates.data]);
  const changes = factoryChanges(kinds, base, draft);

  const save = useMutation({
    mutationFn: () => bildirimProfilService.fabrikaVarsayilaniYaz(changes.turler),
    onSuccess: () => {
      toast.success("Fabrika varsayılanı kaydedildi.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const patch = (tur: string, p: Partial<FactoryDraftRow>) => setDraft((d) => ({ ...d, [tur]: { ...d[tur]!, ...p } }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Katalog varsayılanının üstüne biner; profil ve kişisel tercih bunun üstüne gelir. “Miras” katalog davranışını korur.
      </p>
      {groupKinds(kinds).map((g) => (
        <section key={g.grup} className="rounded-md border">
          <h3 className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.grup}</h3>
          <ul className="divide-y">
            {g.items.map((k) =>
              draft[k.tur] ? (
                <FactoryRow key={k.tur} kind={k} row={draft[k.tur]!} names={names} onPatch={(p) => patch(k.tur, p)} onPick={() => setPickerFor(k.tur)} />
              ) : null,
            )}
          </ul>
        </section>
      ))}
      {/* PageBody `p-4 md:p-6` kaydırır: bottom-0 dolgunun ÜSTÜNE yapışıp içeriği altından gösteriyordu → negatif alt + eş dolgu. */}
      <div role="toolbar" aria-label="Fabrika varsayılanı kaydet" className="sticky -bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 border-t bg-background pb-4 pt-2 shadow-[0_-6px_8px_-6px_rgb(0_0_0/0.12)] md:-bottom-6 md:pb-6">
        {changes.errors.length > 0 && <span className="mr-auto text-xs text-destructive">{changes.errors[0]}</span>}
        {changes.errors.length === 0 && changes.turler.length > 0 && (
          <span className="mr-auto text-xs text-muted-foreground">{changes.turler.length} türde değişiklik</span>
        )}
        {changes.turler.length > 0 && <Button variant="outline" onClick={() => setDraft(base)}>Geri al</Button>}
        <Button disabled={changes.turler.length === 0 || changes.errors.length > 0 || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
      </div>
      <UserPickerDialog
        open={pickerFor !== null}
        onOpenChange={(o) => !o && setPickerFor(null)}
        title="Ek alıcı ekle"
        candidates={candidates.data?.items ?? []}
        exclude={new Set(pickerFor ? draft[pickerFor]?.ekAlicilar ?? [] : [])}
        onConfirm={(add) => pickerFor && patch(pickerFor, { ekAlicilar: [...(draft[pickerFor]?.ekAlicilar ?? []), ...add] })}
      />
    </div>
  );
}

interface RowProps {
  kind: FactoryDefaultKind;
  row: FactoryDraftRow;
  names: ReadonlyMap<string, string>;
  onPatch: (p: Partial<FactoryDraftRow>) => void;
  onPick: () => void;
}

function FactoryRow({ kind: k, row, names, onPatch, onPick }: RowProps) {
  return (
    <li className="space-y-2 px-3 py-2.5" data-testid={`fabrika-${k.tur}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-[12rem] flex-1 text-sm font-medium">{k.ad}</span>
        <div role="radiogroup" aria-label={`${k.ad} fabrika varsayılanı`} className="inline-flex overflow-hidden rounded-md border text-xs">
          {STATES.filter((s) => s !== "KAPALI" || allowsOff(k.kilit)).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={row.durum === s}
              onClick={() => onPatch({ durum: s })}
              className={cn("border-r px-2.5 py-1 last:border-r-0", row.durum === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {FACTORY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {k.esikVar &&
          Object.keys(row.esikMetin).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{ESIK_LABEL[f] ?? f}</span>
              <Input
                inputMode="decimal"
                className="h-7 w-20 text-right"
                value={row.esikMetin[f]}
                aria-label={`${k.ad}: ${ESIK_LABEL[f] ?? f}`}
                onChange={(e) => onPatch({ esikMetin: { ...row.esikMetin, [f]: e.target.value } })}
              />
            </label>
          ))}
        {row.ekAlicilar.map((u) => (
          <span key={u} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1">
            {names.get(u) ?? "Bilinmeyen kişi"}
            <button type="button" aria-label={`${names.get(u) ?? ""} alıcıyı çıkar`} className="rounded-full p-0.5 hover:bg-muted" onClick={() => onPatch({ ekAlicilar: row.ekAlicilar.filter((x) => x !== u) })}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onPick}>
          <UserPlus className="mr-1 h-3.5 w-3.5" /> Ek alıcı
        </Button>
      </div>
    </li>
  );
}
