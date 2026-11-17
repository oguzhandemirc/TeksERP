import { useState } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
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

/** Toplam tel (salt-okunur): yalnız geçerli tam sayılar toplanır; özet kolonu sunucuda aynı satırlardan türer. */
export function totalEnds(yarns: WarpSpecFormValues["yarns"]): number {
  return yarns.reduce((s, r) => {
    const n = parseInput(String(r.endsCount ?? ""));
    return n !== null && Number.isInteger(n) && n > 0 ? s + n : s;
  }, 0);
}

/** "1000 m'ye kg'dan": satır için kg yaz → sunucu telin önerisini ve yuvarlama farkını verir (YAZMAZ). */
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
    <div className="col-span-full flex flex-wrap items-center gap-2 pl-8 text-xs">
      <Input className="h-7 w-28" inputMode="decimal" placeholder="kg / 1000 m" value={kg} onChange={(e) => setKg(e.target.value)} aria-label="1000 metrede kg" />
      <Button type="button" size="sm" variant="secondary" className="h-7" onClick={() => void apply()}>Tele çevir</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onDone}>Kapat</Button>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </div>
  );
}

/** İplik satırları: harf (A/B/C — talimattaki ad) · iplik (doğrudan modal) · tel · kg yardımcısı · sil. */
export function YarnRowsEditor() {
  const { control, register, formState } = useFormContext<WarpSpecFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "yarns" });
  const yarns = useWatch({ control, name: "yarns" }) ?? [];
  const [kgRow, setKgRow] = useState<number | null>(null);
  const errs = formState.errors.yarns;
  return (
    <div className="space-y-2" data-testid="warp-yarn-rows">
      <div className="text-sm font-medium">Çözgü iplikleri</div>
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[1.5rem_1fr_6.5rem_auto_auto] items-start gap-2">
          <span className="pt-2 text-center font-mono text-sm font-semibold">{yarnLetter(i)}</span>
          {/* Yalnız İPLİK kalemleri (süzgeç sunucuda); backend ayrıca YARN + denyeli olduğunu doğrular. */}
          <Controller
            control={control}
            name={`yarns.${i}.yarnItemId`}
            render={({ field }) => (
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
              />
            )}
          />
          <Input {...register(`yarns.${i}.endsCount`)} inputMode="numeric" placeholder="Tel adedi" aria-label={`${yarnLetter(i)} tel adedi`} />
          <Button type="button" size="sm" variant="outline" title="1000 m'ye kg'dan tel" onClick={() => setKgRow(kgRow === i ? null : i)}>
            <Scale className="h-3.5 w-3.5" /> 1000 m'ye kg'dan
          </Button>
          <Button type="button" size="icon" variant="ghost" className="text-destructive" disabled={fields.length <= 1} aria-label={`${yarnLetter(i)} satırını sil`} onClick={() => remove(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {kgRow === i ? <KgHelper index={i} onDone={() => setKgRow(null)} /> : null}
          {errs?.[i] ? (
            <p className="text-destructive col-span-full pl-8 text-xs">{errs[i]?.yarnItemId?.message ?? errs[i]?.endsCount?.message}</p>
          ) : null}
        </div>
      ))}
      {errs?.root?.message || errs?.message ? <p className="text-destructive text-xs">{errs?.root?.message ?? errs?.message}</p> : null}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" disabled={fields.length >= WARP_SPEC_MAX_YARNS} onClick={() => append({ yarnItemId: "", endsCount: "" })}>
          <Plus className="h-3.5 w-3.5" /> İplik ekle
        </Button>
        <span className="text-sm" data-testid="warp-total-ends">
          Toplam tel (kenar dahil): <span className="font-semibold">{formatQty(totalEnds(yarns), 0)}</span>
        </span>
      </div>
    </div>
  );
}
