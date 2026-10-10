// =============================================================================
// TAKVİM ETKİSİ — önizlemedeki HER pencere tek tek (soyut sayı yetmez)
// =============================================================================
import type { ShiftDefinitionPreview, ShiftPreviewWindow } from "./types";

const GROUPS: ReadonlyArray<{ key: keyof ShiftDefinitionPreview; title: string; tone: string }> = [
  { key: "create", title: "Doğacak pencereler", tone: "text-emerald-700 dark:text-emerald-400" },
  { key: "rewrite", title: "Saati değişecek pencereler (başlamamış)", tone: "text-amber-700 dark:text-amber-400" },
  { key: "retire", title: "İptal edilecek pencereler (başlamamış)", tone: "text-destructive" },
  { key: "kept", title: "DEĞİŞMEYECEK pencereler (başlamış ya da karnesi mühürlü)", tone: "text-muted-foreground" },
];

function Row({ w }: { w: ShiftPreviewWindow }) {
  return (
    <li className="font-mono text-xs">
      {w.factoryDay} · {w.startsAt} → {w.endsAt}
      {w.to ? <span> ⇒ {w.to.startsAt} → {w.to.endsAt}</span> : null}
    </li>
  );
}

export function ShiftPreviewList({ preview }: { preview: ShiftDefinitionPreview }) {
  const empty = GROUPS.every((g) => preview[g.key].length === 0);
  if (empty) return <p className="text-muted-foreground text-sm">Takvimde (önümüzdeki 30 gün) değişiklik yok. Geçmiş ve başlamış vardiyalar hiçbir durumda değişmez.</p>;
  return (
    <div className="max-h-64 space-y-3 overflow-y-auto rounded border p-3">
      {GROUPS.filter((g) => preview[g.key].length > 0).map((g) => (
        <section key={g.key} aria-label={g.title}>
          <h4 className={`text-sm font-medium ${g.tone}`}>
            {g.title} — {preview[g.key].length}
          </h4>
          <ul className="mt-1 space-y-0.5">
            {preview[g.key].map((w, i) => (
              <Row key={w.id ?? `${g.key}-${i}`} w={w} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
