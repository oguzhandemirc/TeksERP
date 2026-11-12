// Sarf normu tabanı (Metre başına / Top başına) + isteğe bağlı kurşun gramaj çeşidi. Çeşit normun KİMLİĞİDİR:
// değişimde kilitli gösterilir. Gramaj seçenekleri kodda değil, kurşun bayrağının çeşit değerleridir.
import { cn } from "@/lib/utils";
import { useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import type { NormBasis } from "./service";

const seg = (on: boolean) =>
  cn("rounded-md border px-3 py-1.5 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted");

export function NormBasisField({ value, onChange }: { value: NormBasis; onChange: (b: NormBasis) => void }) {
  return (
    <div>
      <span className="text-muted-foreground">Taban</span>
      <div className="mt-1 flex gap-2" role="group" aria-label="Taban">
        <button type="button" className={seg(value === "PER_METER")} aria-pressed={value === "PER_METER"} onClick={() => onChange("PER_METER")}>
          Metre başına
        </button>
        <button type="button" className={seg(value === "PER_ROLL")} aria-pressed={value === "PER_ROLL"} onClick={() => onChange("PER_ROLL")}>
          Top başına
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {value === "PER_ROLL" ? "Tamburdan çıkan her top için bu miktar düşer (ör. 1 adet poşet)." : "İşlenen her metre için bu miktar düşer (ör. kurşun ipi)."}
      </p>
    </div>
  );
}

export function NormVariantField({ value, onChange, locked }: { value: string | null; onChange: (id: string | null) => void; locked: boolean }) {
  const { catalog } = useKursunGramajCatalog();
  if (catalog.options.length === 0 && !value) return null;
  return (
    <div>
      <span className="text-muted-foreground">Kurşun gramajı (isteğe bağlı)</span>
      <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Kurşun gramajı">
        <button type="button" disabled={locked} className={seg(value === null)} aria-pressed={value === null} onClick={() => onChange(null)}>
          Tüm gramajlar
        </button>
        {catalog.options.map((o) => (
          <button key={o.id} type="button" disabled={locked} className={seg(value === o.id)} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Gramaja özel norm varsa o gramajda çeşitsiz normun yerine geçer.</p>
    </div>
  );
}
