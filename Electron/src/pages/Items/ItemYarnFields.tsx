// SY-a (Seyitoğlu): iplik kartının numara + satın alma birimi alanları. Fantezi iplik (pul, payet şerit) adetle
// ya da metreyle alınır, denyesi yoktur ve kg stoğuna girmez. Denye için dtex/Nm/Ne/g/m çevirici ve "600 KAR İPİ"
// tipi addan ÖNERİ (kullanıcı tıklamadan yazılmaz) burada; hesap sunucuda.
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
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

const PURCHASE_UNITS = [
  { value: "KG", label: "Kg" },
  { value: "ADET", label: "Adet" },
  { value: "METRE", label: "Metre" },
] as const;

export function ItemYarnFields({ form }: { form: UseFormReturn<ItemFormValues> }) {
  const unit = form.watch("yarnPurchaseUnit");
  const fancy = unit !== "KG";
  const denier = form.watch("linearDensityDen");
  const suggestion = denier.trim() === "" ? denierSuggestionFromName(form.watch("name") ?? "") : null;
  // Tek alan (jargon denetimi): "İplik türü" lif türüyle karışıyordu; normal iplik Kg, fantezi Adet/Metre.
  const setUnit = (v: ItemFormValues["yarnPurchaseUnit"]) => {
    form.setValue("yarnPurchaseUnit", v, { shouldDirty: true });
    if (v !== "ADET") form.setValue("yarnPiecesPerM", "", { shouldDirty: true });
  };
  const applyDenier = (text: string) => form.setValue("linearDensityDen", text, { shouldDirty: true, shouldValidate: true });

  return (
    <>
      <FormField label="Alım birimi" hint={fancy ? "Fantezi iplik (pul, payet şerit)" : "Normal iplik"} info="Normal iplik kg ile alınır. Fantezi iplik (pul, payet şerit) adetle ya da metreyle alınır; denyesi gerekmez, kg stoğuna ve iplik ihtiyacına girmez, çözgüde kullanılamaz. Maliyet bu birimin fiyatıyla hesaplanır: adet → metredeki adet × adet fiyatı; metre → iplik metresi × metre fiyatı.">
        <div className="grid grid-cols-3 gap-1 rounded-md border p-1" role="radiogroup" aria-label="Alım birimi">
          {PURCHASE_UNITS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={unit === o.value}
              onClick={() => setUnit(o.value)}
              className={cn("rounded px-2 py-1.5 text-sm transition-colors", unit === o.value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </FormField>

      {unit === "ADET" && (
        <FormField label="İplik metresindeki adet" htmlFor="yarnPiecesPerM" error={form.formState.errors.yarnPiecesPerM} info="Örn. 3 mm pul ipliğinde 1 metrede yaklaşık 333 pul. Maliyette atkı ipliği boyu × bu sayı × adet fiyatı.">
          <Input id="yarnPiecesPerM" inputMode="decimal" placeholder="ör. 333" {...form.register("yarnPiecesPerM")} />
        </FormField>
      )}

      <FormField
        label="İplik numarası (denye)"
        htmlFor="linearDensityDen"
        error={form.formState.errors.linearDensityDen}
        info="Kg ve maliyet hesabı bundan — kg = boy × denye ÷ 9.000.000 (çözgüde boy = tel × metre). Denyesiz iplik çözgüye yazılamaz. Elinizde dtex/Nm/Ne/g/m varsa çeviriciyi kullanın."
      >
        <Input id="linearDensityDen" inputMode="decimal" placeholder={fancy ? "Boş bırakılabilir" : "ör. 150"} {...form.register("linearDensityDen")} />
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
