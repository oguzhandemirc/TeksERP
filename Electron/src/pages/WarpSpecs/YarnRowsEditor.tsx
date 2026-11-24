import { useState } from "react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { Package, Plus, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { suggestWarpEnds } from "@/pages/Operations/WarpPlan/service";
import { fmtKg, parseInput, yarnLetter } from "@/pages/Operations/WarpPlan/warp-plan-model";
import { formatQty } from "@/lib/format";
import { WARP_SPEC_MAX_YARNS, type WarpSpecFormValues } from "./schema";
import { useWarpCalc } from "./useWarpCalc";
import { yarnOwnWasteNote } from "@/pages/Operations/WarpPlan/yarn-waste-note";

/** Toplam tel (salt-okunur): yalnız geçerli tam sayılar toplanır; özet kolonu sunucuda aynı satırlardan türer. */
export function totalEnds(yarns: WarpSpecFormValues["yarns"]): number {
  return yarns.reduce((s, r) => {
    const n = parseInput(String(r.endsCount ?? ""));
    return n !== null && Number.isInteger(n) && n > 0 ? s + n : s;
  }, 0);
}

/** "1000 m'ye kg'dan": satır için kg yaz → sunucu telin önerisini ve yuvarlama farkını verir. */
function KgHelper({ index, onDone }: { index: number; onDone: () => void }) {
  const { getValues, setValue } = useFormContext<WarpSpecFormValues>();
  const [kg, setKg] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const apply = async () => {
    const yarnItemId = getValues(`yarns.${index}.yarnItemId`);
    const v = parseInput(kg);
    if (!yarnItemId) return setNote("Önce ipliği seçin.");
    if (v === null || v <= 0) return setNote("Kg sıfırdan büyük olmalı.");
    try {
      const r = await suggestWarpEnds({ kind: "KG_PER_1000M", yarnItemId, kgPer1000m: v });
      setValue(`yarns.${index}.endsCount`, String(r.endsCount), { shouldDirty: true, shouldValidate: true });
      setNote(`${formatQty(r.endsCount, 0)} tel yazıldı (${r.denier ?? "?"} den) · fark ${fmtKg(r.diffKg ?? 0)} kg`);
    } catch {
      setNote(null); // apiClient hatayı zaten bildirdi
    }
  };
  return (
    <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs sm:ml-10">
      <span className="text-muted-foreground">1000 m'de kaç kg?</span>
      <Input className="h-8 w-28" inputMode="decimal" placeholder="kg / 1000 m" value={kg} onChange={(e) => setKg(e.target.value)} aria-label="1000 metrede kg" />
      <Button type="button" size="sm" variant="secondary" className="h-8" onClick={() => void apply()}>Tele çevir</Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onDone}>Kapat</Button>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[2rem_minmax(0,1fr)_6.5rem_auto_2.25rem] items-center gap-x-2";

/** İplik satırları: harf (A/B/C — talimattaki ad) · iplik (doğrudan modal; ad + küçük kod/denye) · tel · kg yardımcısı · sil. */
export function YarnRowsEditor() {
  const { control, register, formState } = useFormContext<WarpSpecFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "yarns" });
  const { yarns, per1000, specWastePct } = useWarpCalc();
  // B6: iplik kartında kendi firesi olan iplikte çözgü firesi uygulanmaz — sunucunun satır kaynağından söylenir.
  const ownWasteNote = (id: string) => {
    const l = per1000?.forward?.lines.find((x) => x.yarnItemId === id);
    return l ? yarnOwnWasteNote(l.wasteSource, l.wastePct, specWastePct) : null;
  };
  const [kgRow, setKgRow] = useState<number | null>(null);
  const errs = formState.errors.yarns;
  const info = (id: string) => per1000?.yarns.find((y) => y.yarnItemId === id);
  return (
    <div className="space-y-2" data-testid="warp-yarn-rows">
      <div className={`${ROW_GRID} px-1 text-xs font-medium text-muted-foreground`}>
        <span />
        <span>İplik</span>
        <span>Tel adedi</span>
        <span />
        <span />
      </div>
      {fields.map((f, i) => {
        const y = info(yarns[i]?.yarnItemId ?? "");
        const note = ownWasteNote(yarns[i]?.yarnItemId ?? "");
        return (
          <div key={f.id} className={`${ROW_GRID} gap-y-2 rounded-lg border bg-background px-1 py-1.5`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 font-mono text-sm font-semibold text-primary">{yarnLetter(i)}</span>
            <div className="flex min-w-0 items-center gap-2">
              {/* Yalnız İPLİK kalemleri (süzgeç sunucuda); backend ayrıca YARN + denyeli olduğunu doğrular. */}
              <Controller
                control={control}
                name={`yarns.${i}.yarnItemId`}
                render={({ field }) => (
                  <div className="min-w-0 flex-1">
                  <EntityPickerModal<Item>
                    value={field.value || null}
                    onChange={(id) => field.onChange(id ?? "")}
                    service={itemService}
                    queryKey="items-warp-yarn"
                    filters={{ itemType: "YARN", lifecycleStatus: "ACTIVE" }}
                    getLabel={(it) => it.name}
                    getSubLabel={(it) => it.code}
                    icon={Package}
                    title={`${yarnLetter(i)} ipliği seç`}
                    placeholder="İplik seç"
                    triggerClassName="h-9 py-1.5"
                  />
                  </div>
                )}
              />
              {y ? <span className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground md:block" title={`${y.code} · ${formatQty(y.denier, 1)} den`} data-testid={`warp-yarn-code-${yarnLetter(i)}`}>{y.code} · {formatQty(y.denier, 1)} den</span> : null}
            </div>
            <Input {...register(`yarns.${i}.endsCount`)} className="h-9 text-right tabular-nums" inputMode="numeric" placeholder="ör. 3000" aria-label={`${yarnLetter(i)} tel adedi`} />
            <Button type="button" size="sm" variant="ghost" className="h-9" title="1000 m'deki kg'dan tel adedi bul" aria-label={`${yarnLetter(i)}: 1000 m'ye kg'dan tel`} onClick={() => setKgRow(kgRow === i ? null : i)}>
              <Scale className="h-3.5 w-3.5" /> kg'dan
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-destructive" disabled={fields.length <= 1} aria-label={`${yarnLetter(i)} satırını sil`} onClick={() => remove(i)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            {note ? <p className="col-span-full text-xs text-amber-700 dark:text-amber-400 sm:ml-10" data-testid={`warp-yarn-waste-note-${yarnLetter(i)}`}>{note}</p> : null}
            {kgRow === i ? <KgHelper index={i} onDone={() => setKgRow(null)} /> : null}
            {errs?.[i] ? <p className="col-span-full text-xs text-destructive sm:ml-10">{errs[i]?.yarnItemId?.message ?? errs[i]?.endsCount?.message}</p> : null}
          </div>
        );
      })}
      {errs?.root?.message || errs?.message ? <p className="text-destructive text-xs">{errs?.root?.message ?? errs?.message}</p> : null}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" size="sm" variant="outline" disabled={fields.length >= WARP_SPEC_MAX_YARNS} onClick={() => append({ yarnItemId: "", endsCount: "" })}>
          <Plus className="h-3.5 w-3.5" /> İplik ekle
        </Button>
        <span className="text-sm text-muted-foreground" data-testid="warp-total-ends">
          Toplam tel (kenar dahil): <span className="font-semibold text-foreground tabular-nums">{formatQty(totalEnds(yarns), 0)}</span>
        </span>
      </div>
    </div>
  );
}
