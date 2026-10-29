// Gramaj önerisi (H9): işlem metni → kurşun gramaj çeşidi. Öneri DEĞER YAZMAZ; operatörün kabul ettiği/düzelttiği
// seçim yalnız onayda PROCESS sözlüğüne öğretilir (bir sonraki belgede "öğrenilmiş" öneri olur).
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import type { ProcessGroup } from "./processChoices";

interface Props {
  groups: readonly ProcessGroup[];
  /** Eşleme yanıtındaki `processOptions`: katalog `fabric-properties` ucundan OKUNMAZ (property:read'siz rolde 403 olurdu). */
  options: ReadonlyArray<{ id: string; name: string }>;
  picks: Readonly<Record<string, string | null>>;
  onPick: (key: string, valueId: string | null) => void;
}

const SOURCE_TAG = { ALIAS: "öğrenilmiş öneri", PATTERN: "öneri", NONE: "" } as const;

export function ProcessGramajPanel({ groups, options: catalogOptions, picks, onPick }: Props) {
  if (groups.length === 0 || catalogOptions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="process-gramaj">
      <div>
        <h3 className="text-sm font-medium">Kurşun gramajı (işlem metninden)</h3>
        <p className="text-xs text-muted-foreground">Öneri yalnız yol gösterir; seçtiğiniz gramaj onayda bu metin için hatırlanır. Hiçbir topa değer yazılmaz.</p>
      </div>
      {groups.map((g) => {
        const s = g.suggestion?.suggested ?? null;
        const tag = g.suggestion ? SOURCE_TAG[g.suggestion.source] : "";
        const options = catalogOptions.map((o) => (s && o.id === s.id && tag ? { ...o, name: `${o.name} (${tag})` } : o));
        return (
          <div key={g.key} className="flex flex-col gap-1" data-testid="process-group" data-suggested={s?.id ?? ""}>
            <p className="text-xs">
              <span className="font-medium">“{g.rawText}”</span>
              <span className="text-muted-foreground"> · {g.key === "header" ? "başlık" : "satır"} · {g.lineCount} satır{s ? "" : " · öneri yok"}</span>
            </p>
            <GramajChoiceButtons options={options} value={picks[g.key] ?? null} onChange={(v) => onPick(g.key, v)} emptyLabel="Seçme" />
          </div>
        );
      })}
    </section>
  );
}
