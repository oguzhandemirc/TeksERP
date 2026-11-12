// Tanıtma paneli: seçili yazı → alan / sütun başlığı / toplam satırı; atananlar; kimlik yazıları; tekrar eden bölüm.
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  addIdentifier, assignColumn, assignField, assignTotals, clearColumn, clearField, COLUMN_OPTIONS, FIELD_OPTIONS, keptOldFields, OLD_PARTS, oldParts, setRepeats, textOf,
  toggleIdentifier, toggleKeepOld, toggleSectionField, type TeachState,
} from "./teachDraft";
import type { ScanWord, TemplateJson } from "./types";

interface Props {
  state: TeachState;
  words: readonly ScanWord[];
  onChange: (fn: (s: TeachState) => TeachState) => void;
  /** "Tanımı düzenle" kipinde eski şablon (korunacakları gösterir). */
  old?: TemplateJson | null;
}

/** Güncelle kipi: eski şablondan neyin taşınacağı açıkça görünür; tablo/bölüm kutusu kaldırılırsa kaydedilen şablondan da kalkar. */
function KeepOld({ state, old, onChange }: { state: TeachState; old: TemplateJson; onChange: Props["onChange"] }) {
  const parts = OLD_PARTS.filter((p) => oldParts(old).includes(p.key));
  const fields = keptOldFields(old, state);
  return (
    <Section title="Eski şablondan korunacak" testId="teach-keep-old">
      {fields.length > 0 && <p className="text-xs text-muted-foreground" data-testid="teach-keep-old-fields">Yeniden atamadığınız alanlar aynen kalır: {fields.join(", ")}</p>}
      {parts.map((p) => (
        <label key={p.key} className="flex items-center gap-2 text-sm">
          <Checkbox checked={state.keepOld.includes(p.key)} onCheckedChange={() => onChange((s) => toggleKeepOld(s, p.key))} aria-label={`Eski ${p.label} korunsun`} data-testid={`teach-keep-old-${p.key}`} />
          {p.label} korunsun <span className="text-xs text-muted-foreground">({p.hint})</span>
        </label>
      ))}
      <p className="text-xs text-muted-foreground">Önizleme, kaydedilecek şablonun tam hâlidir.</p>
    </Section>
  );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 rounded-lg border p-3" data-testid={testId}>
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Assigned({ state, words, onChange }: Props) {
  const rows = [
    ...FIELD_OPTIONS.filter((f) => state.fields[f.key]?.length).map((f) => ({ id: `f-${f.key}`, label: f.label, text: textOf(words, state.fields[f.key]!), clear: (s: TeachState) => clearField(s, f.key) })),
    ...COLUMN_OPTIONS.filter((c) => state.columns[c.key]?.length).map((c) => ({ id: `c-${c.key}`, label: `Sütun: ${c.label}`, text: textOf(words, state.columns[c.key]!), clear: (s: TeachState) => clearColumn(s, c.key) })),
    ...(state.totalsLabel?.length ? [{ id: "t", label: "Toplam satırı", text: textOf(words, state.totalsLabel), clear: (s: TeachState) => ({ ...s, totalsLabel: null }) }] : []),
  ];
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Henüz alan atanmadı.</p>;
  return (
    <ul className="space-y-1 text-sm" data-testid="teach-assigned">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2" data-testid={`teach-assigned-${r.id}`}>
          <span className="w-28 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.text}</span>
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={`${r.label} atamasını kaldır`} onClick={() => onChange(r.clear)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function TeachPanel({ state, words, onChange, old }: Props) {
  const sel = textOf(words, state.selected);
  const has = state.selected.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="teach-panel">
      {old && <KeepOld state={state} old={old} onChange={onChange} />}
      <label className="space-y-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Belge tipinin adı</span>
        <Input value={state.name} maxLength={80} placeholder="ör. Güleçsoy çeki listesi" onChange={(e) => { const name = e.target.value; onChange((s) => ({ ...s, name })); }} data-testid="teach-name" />
      </label>
      <Section title="1. Fotoğrafta yazıya dokunun, sonra ne olduğunu seçin" testId="teach-assign">
        <p className="text-sm" data-testid="teach-selected">
          Seçili: {has ? <b className="font-mono">{sel}</b> : <span className="text-muted-foreground">yok — değerin kutusuna dokunun (birden çok kelime seçilebilir)</span>}
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Alan ata">
          {FIELD_OPTIONS.map((f) => (
            <Button key={f.key} type="button" size="sm" variant="outline" disabled={!has} onClick={() => onChange((s) => assignField(s, words, f.key))} data-testid={`teach-field-${f.key}`}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Top tablosu sütun başlığı">
          {COLUMN_OPTIONS.map((c) => (
            <Button key={c.key} type="button" size="sm" variant="outline" disabled={!has} onClick={() => onChange((s) => assignColumn(s, words, c.key))} data-testid={`teach-column-${c.key}`}>
              Sütun: {c.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" disabled={!has} onClick={() => onChange((s) => assignTotals(s, words))} data-testid="teach-totals">Toplam satırı</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!has} onClick={() => onChange((s) => ({ ...s, selected: [] }))}>Seçimi bırak</Button>
        </div>
        <p className="text-xs text-muted-foreground">Değere dokunun (ör. parti numarasının kendisi); sistem yanındaki basılı etiketi bulur. Sütun için başlık yazısına dokunun.</p>
        <Assigned state={state} words={words} onChange={onChange} />
      </Section>
      <Section title="2. Kimlik yazıları (bu tip belgeyi tanıtan sabit yazılar)" testId="teach-identifiers">
        <div className="flex flex-col gap-1">
          {state.identifiers.map((d) => (
            <label key={d.text} className="flex items-center gap-2 text-sm">
              <Checkbox checked={d.on} onCheckedChange={() => onChange((s) => toggleIdentifier(s, d.text))} aria-label={`Kimlik: ${d.text}`} />
              <span className="min-w-0 truncate">{d.text}</span>
            </label>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!has} onClick={() => onChange((s) => addIdentifier({ ...s, selected: [] }, sel))} data-testid="teach-add-identifier">Seçili yazıyı kimlik yap</Button>
        <p className="text-xs text-muted-foreground">Başlık, firma adı, sütun başlıkları gibi her belgede aynı kalan yazıları işaretleyin; müşteri adı ya da numara gibi değişenleri değil.</p>
      </Section>
      <Section title="3. Bu bölüm tekrar eder mi?" testId="teach-section">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={state.repeats} onCheckedChange={(v) => onChange((s) => setRepeats(s, v === true))} aria-label="Bu bölüm tekrar eder" data-testid="teach-repeats" />
          Bu bölüm tekrar eder (bir kağıtta birden çok parti)
        </label>
        {state.repeats && (
          <div className="space-y-2 pl-6">
            <div className="flex items-center gap-2">
              <Input value={state.sectionStart} maxLength={40} placeholder="Bölüm başlangıç yazısı (ör. Ham PartiNo)" onChange={(e) => { const v = e.target.value; onChange((s) => ({ ...s, sectionStart: v })); }} data-testid="teach-section-start" />
              <Button type="button" size="sm" variant="outline" disabled={!has} onClick={() => onChange((s) => ({ ...s, sectionStart: sel.slice(0, 40), selected: [] }))} data-testid="teach-section-from-selection">Seçili yazıyı al</Button>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {FIELD_OPTIONS.filter((f) => state.fields[f.key]?.length).map((f) => (
                <label key={f.key} className="flex items-center gap-1">
                  <Checkbox checked={state.sectionFields.includes(f.key)} onCheckedChange={() => onChange((s) => toggleSectionField(s, f.key))} aria-label={`${f.label} bölüm başına`} />
                  {f.label} bölüm başına
                </label>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
