// BAYİ TAVANI alanları — modül ⊆ · sınıf ⊆ · kurulum adedi · kanallar · kalıcı izni (varsayılan
// HAYIR) · bakım ay tavanı (yönetici kararı g).
// Tavan sürümlü defterdir: her değişim yeni sürüm satırıdır, eskisi kalır.
import { CLASS_LABEL, MODULE_LABEL, label } from "./labels";
import type { Ceiling, Channel } from "./types";
import { Field } from "./ui";

export interface CeilingDraft {
  readonly modules: string[];
  readonly classes: string[];
  readonly count: string;
  readonly channels: string[];
  readonly perpetualAllowed: boolean;
  readonly maintenanceMonths: string;
}

export const DEFAULT_MAINTENANCE_MONTHS = 12;
export const MAX_MAINTENANCE_MONTHS = 120;

export function ceilingDraftOf(c: Ceiling | null): CeilingDraft {
  return {
    modules: c ? [...c.moduller] : ["production.enabled"],
    classes: c ? [...c.siniflar] : ["URETIM"],
    count: String(c?.kurulumAdedi ?? 5),
    channels: c ? [...c.kanallar] : [],
    perpetualAllowed: c?.kaliciIzni ?? false,
    maintenanceMonths: String(c?.bakimAyTavani ?? DEFAULT_MAINTENANCE_MONTHS),
  };
}

export function ceilingDraftValid(d: CeilingDraft): boolean {
  const n = Number(d.count);
  if (!/^\d{1,6}$/.test(d.count) || n > 100_000 || d.classes.length === 0) return false;
  const m = Number(d.maintenanceMonths);
  return /^\d{1,3}$/.test(d.maintenanceMonths) && m >= 1 && m <= MAX_MAINTENANCE_MONTHS;
}

/** Sunucu gövdesi (`tavan`, KATI şema). */
export function ceilingBody(d: CeilingDraft): Record<string, unknown> {
  return {
    moduller: d.modules,
    siniflar: d.classes,
    kurulumAdedi: Number(d.count),
    kanallar: d.channels,
    kaliciIzni: d.perpetualAllowed,
    bakimAyTavani: Number(d.maintenanceMonths),
  };
}

export function ceilingSummary(c: Ceiling | null): string {
  if (!c) return "Tavan yok";
  const parts = [`${c.kurulumAdedi} kurulum`, c.siniflar.map((s) => label(CLASS_LABEL, s)).join(", "), `${c.moduller.length} modül`];
  parts.push(c.kanallar.length ? `kanal: ${c.kanallar.join(", ")}` : "kanal yok");
  parts.push(c.kaliciIzni ? "kalıcı izni var" : "kalıcı izni yok");
  parts.push(`bakım ≤ ${c.bakimAyTavani} ay`);
  return parts.join(" · ");
}

function toggle(list: readonly string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function CeilingFields({
  draft,
  onChange,
  modules,
  classes,
  channels,
}: {
  draft: CeilingDraft;
  onChange: (d: CeilingDraft) => void;
  modules: readonly string[];
  classes: readonly string[];
  channels: readonly Channel[];
}) {
  const set = (patch: Partial<CeilingDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="field">
        <span className="field-label">Modüller (bayinin imzalayabileceği tavan)</span>
        <div className="checks">
          {modules.map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={draft.modules.includes(m)} onChange={() => set({ modules: toggle(draft.modules, m) })} />
              {label(MODULE_LABEL, m)}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Lisans sınıfları (en az biri)</span>
        <div className="checks">
          {classes.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={draft.classes.includes(c)} onChange={() => set({ classes: toggle(draft.classes, c) })} />
              {label(CLASS_LABEL, c)}
            </label>
          ))}
        </div>
      </div>
      <Field label="Kurulum adedi (en çok)">
        <input type="number" min={0} max={100000} value={draft.count} onChange={(e) => set({ count: e.target.value })} />
      </Field>
      <div className="field">
        <span className="field-label">Kanallar (bayi yalnız bunlarda kurulum açar; boş = açamaz)</span>
        {channels.length === 0 ? <span className="field-hint">Kanal kataloğu boş: önce Kanallar ekranında kanal açın.</span> : null}
        <div className="checks">
          {channels.map((c) => (
            <label key={c.kod} className="check">
              <input type="checkbox" checked={draft.channels.includes(c.kod)} onChange={() => set({ channels: toggle(draft.channels, c.kod) })} />
              {c.ad} ({c.kod})
            </label>
          ))}
        </div>
      </div>
      <label className="check field">
        <input type="checkbox" checked={draft.perpetualAllowed} onChange={(e) => set({ perpetualAllowed: e.target.checked })} />
        Bayi kalıcı lisans imzalayabilir (varsayılan: hayır)
      </label>
      <Field label="Bakım ay tavanı" hint={`Bayinin imzaladığı lisansta bakım bitişi imzadan en çok bu kadar ay sonra olabilir (1–${MAX_MAINTENANCE_MONTHS}).`}>
        <input type="number" min={1} max={MAX_MAINTENANCE_MONTHS} value={draft.maintenanceMonths} onChange={(e) => set({ maintenanceMonths: e.target.value })} />
      </Field>
    </>
  );
}
