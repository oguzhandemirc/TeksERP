// İşlem önerisi (H9 gramaj; D4-D1 her çeşit): işlem metni → kurşun gramajı ve kurşun dışı çeşit değerleri (brode deseni…).
// Öneri DEĞER YAZMAZ; operatörün kabul ettiği/düzelttiği seçim yalnız onayda PROCESS sözlüğüne öğretilir.
// Sözlük metin başına TEK değer tutar: bir metin grubunda bütün özellik satırları aynı seçimi paylaşır.
import { useState } from "react";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { Button } from "@/components/ui/button";
import { ProcessValueSearchDialog } from "./ProcessValueSearchDialog";
import type { ProcessGroup } from "./processChoices";
import type { ProcessChoiceGroup, ProcessSuggestion } from "./types";

interface Props {
  groups: readonly ProcessGroup[];
  /** Eşleme yanıtındaki `processOptions`: katalog `fabric-properties` ucundan OKUNMAZ (property:read'siz rolde 403 olurdu). */
  options: ReadonlyArray<{ id: string; name: string }>;
  /** Eşleme yanıtındaki `processGroups` (kurşun dışı çeşitler); yoksa panel yalnız kurşunu çizer (H9 görünümü). */
  choiceGroups?: readonly ProcessChoiceGroup[];
  picks: Readonly<Record<string, string | null>>;
  onPick: (key: string, valueId: string | null) => void;
}

const SOURCE_TAG = { ALIAS: "öğrenilmiş öneri", PATTERN: "öneri", NONE: "" } as const;
/** Bundan büyük katalogda (yüzlerce desen) düğme dizisi yerine yalnız önerilen değer gösterilir. */
export const MAX_INLINE_OPTIONS = 12;

type Option = { id: string; name: string };

function tagged(options: readonly Option[], s: Pick<ProcessSuggestion, "suggested" | "source"> | null): Option[] {
  const hit = s?.suggested ?? null;
  const tag = s ? SOURCE_TAG[s.source] : "";
  return options.map((o) => (hit && o.id === hit.id && tag ? { ...o, name: `${o.name} (${tag})` } : o));
}

/** Bir özelliğin düğme satırı: seçim bu özelliğe aitse işaretli; "Seçme" yalnız kendi seçimini temizler. */
function ChoiceRow({ label, options, pick, onPick }: { label: string | null; options: readonly Option[]; pick: string | null; onPick: (v: string | null) => void }) {
  const own = pick !== null && options.some((o) => o.id === pick) ? pick : null;
  return (
    <div className="flex flex-col gap-1" data-testid="process-row">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <GramajChoiceButtons options={options} value={own} onChange={(v) => (v !== null || own !== null ? onPick(v) : undefined)} emptyLabel="Seçme" />
    </div>
  );
}

export function ProcessGramajPanel({ groups, options: catalogOptions, choiceGroups = [], picks, onPick }: Props) {
  // Büyük katalogda tam liste sunucu aramalı modalda (D4-D2c); hangi metin grubu + özellik için açık.
  const [searching, setSearching] = useState<{ key: string; group: ProcessChoiceGroup } | null>(null);
  if (groups.length === 0 || (catalogOptions.length === 0 && choiceGroups.length === 0)) return null;
  const grouped = choiceGroups.length > 0;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="process-gramaj">
      <div>
        <h3 className="text-sm font-medium">{grouped ? "İşlem çeşidi (işlem metninden)" : "Kurşun gramajı (işlem metninden)"}</h3>
        <p className="text-xs text-muted-foreground">
          {grouped
            ? "Öneri yalnız yol gösterir; her metin için seçtiğiniz TEK değer onayda hatırlanır (metne daha önce başka özellikten öğretilmiş değer varsa o korunur). Hiçbir topa değer yazılmaz."
            : "Öneri yalnız yol gösterir; seçtiğiniz gramaj onayda bu metin için hatırlanır. Hiçbir topa değer yazılmaz."}
        </p>
      </div>
      {groups.map((g) => {
        const s = g.suggestion?.suggested ?? null;
        const variants = g.suggestion?.variants ?? [];
        const anySuggestion = !!s || variants.some((v) => v.suggested);
        const pick = picks[g.key] ?? null;
        return (
          <div key={g.key} className="flex flex-col gap-1" data-testid="process-group" data-suggested={s?.id ?? ""}>
            <p className="text-xs">
              <span className="font-medium">“{g.rawText}”</span>
              <span className="text-muted-foreground"> · {g.key === "header" ? "başlık" : "satır"} · {g.lineCount} satır{anySuggestion ? "" : " · öneri yok"}</span>
            </p>
            {!grouped ? (
              <GramajChoiceButtons options={tagged(catalogOptions, g.suggestion)} value={pick} onChange={(v) => onPick(g.key, v)} emptyLabel="Seçme" />
            ) : (
              <>
                {catalogOptions.length > 0 && <ChoiceRow label="Kurşun gramajı" options={tagged(catalogOptions, g.suggestion)} pick={pick} onPick={(v) => onPick(g.key, v)} />}
                {choiceGroups.map((cg) => {
                  const vs = variants.find((v) => v.propertyId === cg.propertyId) ?? null;
                  const big = cg.options.length > MAX_INLINE_OPTIONS;
                  // Büyük katalog: yalnız önerilen (ve seçili) değer — tam liste aranabilir seçici ister (D4-D2).
                  const shown = big ? cg.options.filter((o) => o.id === vs?.suggested?.id || o.id === pick) : cg.options;
                  return (
                    <div key={cg.propertyId} data-testid="process-variant" data-property={cg.propertyId} data-suggested={vs?.suggested?.id ?? ""}>
                      <ChoiceRow label={big ? `${cg.propertyName} (yalnız öneri gösteriliyor)` : cg.propertyName} options={tagged(shown, vs)} pick={pick} onPick={(v) => onPick(g.key, v)} />
                      {big && (
                        <Button type="button" size="sm" variant="outline" className="mt-1" data-testid="process-variant-search" onClick={() => setSearching({ key: g.key, group: cg })}>
                          Ara…
                        </Button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
      {searching && (
        <ProcessValueSearchDialog
          open
          onOpenChange={(o) => !o && setSearching(null)}
          propertyId={searching.group.propertyId}
          propertyName={searching.group.propertyName}
          selectedId={picks[searching.key] ?? null}
          onSelect={(v) => onPick(searching.key, v.id)}
        />
      )}
    </section>
  );
}
