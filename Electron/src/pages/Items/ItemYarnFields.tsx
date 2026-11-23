// SY-a (Seyitoğlu): iplik kartının numara + satın alma birimi alanları. Fantezi iplik (pul, payet şerit) adetle
// ya da metreyle alınır, denyesi yoktur ve kg stoğuna girmez. Denye için dtex/Nm/Ne/g/m çevirici ve "600 KAR İPİ"
// tipi addan ÖNERİ (kullanıcı tıklamadan yazılmaz) burada; hesap sunucuda.
import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Sparkles } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  YARN_COUNT_UNIT_LABEL,
  denierSuggestionFromName,
  formatDenierText,
  parseLooseNumber,
  toDenier,
  type YarnCountUnit,
} from "@/lib/yarn-count";
import type { ItemFormValues } from "./schema";

const FANCY_UNIT_LABEL = { ADET: "Adet", METRE: "Metre" } as const;

export function ItemYarnFields({ form }: { form: UseFormReturn<ItemFormValues> }) {
  const unit = form.watch("yarnPurchaseUnit");
  const fancy = unit !== "KG";
  const denier = form.watch("linearDensityDen");
  const suggestion = denier.trim() === "" ? denierSuggestionFromName(form.watch("name") ?? "") : null;
  // Yeni fantezi kartta varsayılan ADET (sektörde pul adetle alınır); normal iplik KG = bugünkü davranış.
  const setFancy = (on: boolean) => {
    form.setValue("yarnPurchaseUnit", on ? "ADET" : "KG", { shouldDirty: true });
    if (!on) form.setValue("yarnPiecesPerM", "", { shouldDirty: true });
  };
  const applyDenier = (text: string) => form.setValue("linearDensityDen", text, { shouldDirty: true, shouldValidate: true });

  return (
    <>
      <FormField label="İplik türü" hint={fancy ? "Pul, payet şerit" : "Kg ile alınır"} info="Fantezi iplik (pul, payet şerit) adetle ya da metreyle alınır; denyesi gerekmez ve kg stoğuna/iplik ihtiyacına girmez. Çözgüde kullanılamaz.">
        <div className="grid grid-cols-2 gap-1 rounded-md border p-1" role="radiogroup" aria-label="İplik türü">
          {([false, true] as const).map((on) => (
            <button
              key={String(on)}
              type="button"
              role="radio"
              aria-checked={fancy === on}
              onClick={() => setFancy(on)}
              className={cn("rounded px-2 py-1.5 text-sm transition-colors", fancy === on ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {on ? "Fantezi" : "Normal"}
            </button>
          ))}
        </div>
      </FormField>

      {fancy && (
        <FormField label="Satın alma birimi" info="Maliyet bu birimin fiyatıyla hesaplanır: adet → metredeki adet × adet fiyatı; metre → iplik metresi × metre fiyatı.">
          <Controller
            control={form.control}
            name="yarnPurchaseUnit"
            render={({ field }) => (
              <EnumSelect<"ADET" | "METRE">
                value={field.value === "METRE" ? "METRE" : "ADET"}
                onChange={(v) => {
                  field.onChange(v);
                  if (v !== "ADET") form.setValue("yarnPiecesPerM", "", { shouldDirty: true });
                }}
                labels={FANCY_UNIT_LABEL}
              />
            )}
          />
        </FormField>
      )}

      {unit === "ADET" && (
        <FormField label="İplik metresindeki adet" htmlFor="yarnPiecesPerM" error={form.formState.errors.yarnPiecesPerM} info="Örn. 3 mm pul ipliğinde 1 metrede yaklaşık 333 pul. Maliyette atkı ipliği boyu × bu sayı × adet fiyatı.">
          <Input id="yarnPiecesPerM" inputMode="decimal" placeholder="333" {...form.register("yarnPiecesPerM")} />
        </FormField>
      )}

      <FormField
        label={fancy ? "Denye" : "Denye (iplik inceliği)"}
        htmlFor="linearDensityDen"
        error={form.formState.errors.linearDensityDen}
        info="Çözgü kartı ve kg hesabı için gerekli — kg = tel × denye × metre ÷ 9.000.000. Elinizde dtex/Nm/Ne/g/m varsa çeviriciyi kullanın."
      >
        <Input id="linearDensityDen" inputMode="decimal" placeholder={fancy ? "Boş bırakılabilir" : "150"} {...form.register("linearDensityDen")} />
        {suggestion && !fancy && (
          <button type="button" onClick={() => applyDenier(suggestion)} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <Sparkles className="h-3 w-3" /> Addaki {suggestion} denye mi? Denye olarak kullan
          </button>
        )}
        <DenierConverter onApply={applyDenier} />
      </FormField>
    </>
  );
}

/** dtex / Nm / Ne / g/m → denye; "Uygula" alana yazar. */
function DenierConverter({ onApply }: { onApply: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [from, setFrom] = useState<YarnCountUnit>("DTEX");
  const den = toDenier(parseLooseNumber(value), from);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 block text-xs text-muted-foreground hover:text-foreground hover:underline">
        Başka birimden çevir (dtex, Nm, Ne, g/m)
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2" data-testid="denier-converter">
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Input aria-label="Çevrilecek değer" inputMode="decimal" placeholder="167" value={value} onChange={(e) => setValue(e.target.value)} />
        <EnumSelect<YarnCountUnit> value={from} onChange={setFrom} labels={YARN_COUNT_UNIT_LABEL} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{den === null ? "Değer girin" : `= ${formatDenierText(den).replace(".", ",")} denye`}</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Kapat</Button>
          <Button type="button" size="sm" disabled={den === null} onClick={() => { if (den !== null) { onApply(formatDenierText(den)); setOpen(false); } }}>
            Uygula
          </Button>
        </div>
      </div>
    </div>
  );
}
