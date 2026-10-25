import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PAPER_SIZES, type PaperSize } from "../editor/pageCanvas";
import { clampMargin, HEADER_TEXT_MAX, PAGE_MARGIN_MAX_MM, PAGE_NUMBER_POSITIONS, pageNumberPreview, pageSettingsIssues, type PageSettings } from "../binding/pageSettings";
import { Section } from "./Section";

interface Props {
  value: PageSettings;
  onChange: (next: PageSettings) => void;
}

const seg = (on: boolean) => cn("flex-1 px-2 py-1.5 text-xs", on ? "bg-primary text-primary-foreground" : "hover:bg-muted");
const MARGINS: Array<[keyof PageSettings["kenar"], string]> = [["ust", "Üst"], ["sag", "Sağ"], ["alt", "Alt"], ["sol", "Sol"]];

function TextBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-0.5 text-[11px] text-muted-foreground">
      {label}
      <Input className="h-8 text-xs" maxLength={HEADER_TEXT_MAX} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Sayfa ayarı → `pageSettings` (@page): kâğıt, yön, kenarlar, üst/alt bilgi, sayfa no; kanvas kılavuzu canlı izler. */
export function PageSettingsPanel({ value: s, onChange }: Props) {
  const set = (patch: Partial<PageSettings>) => onChange({ ...s, ...patch });
  const issues = pageSettingsIssues(s);
  return (
    <div data-testid="sayfa-ayari">
      <Section title="Kâğıt ve yön">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Kâğıt">
          {(Object.keys(PAPER_SIZES) as PaperSize[]).map((k) => (
            <button key={k} type="button" aria-pressed={s.kagit === k} className={seg(s.kagit === k)} onClick={() => set({ kagit: k })}>{PAPER_SIZES[k].label}</button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Yön">
          {(["dikey", "yatay"] as const).map((y) => (
            <button key={y} type="button" aria-pressed={s.yon === y} className={seg(s.yon === y)} onClick={() => set({ yon: y })}>{y === "dikey" ? "Dikey" : "Yatay"}</button>
          ))}
        </div>
      </Section>
      <Section title={`Kenar boşlukları (0–${PAGE_MARGIN_MAX_MM} mm)`}>
        <div className="grid grid-cols-4 gap-1.5">
          {MARGINS.map(([k, label]) => (
            <label key={k} className="space-y-0.5 text-[11px] text-muted-foreground">
              {label}
              <Input type="number" min={0} max={PAGE_MARGIN_MAX_MM} step={0.5} aria-label={`${label} kenar`} className="h-8 px-1.5 text-xs" value={s.kenar[k]} onChange={(e) => set({ kenar: { ...s.kenar, [k]: clampMargin(Number(e.target.value)) } })} />
            </label>
          ))}
        </div>
      </Section>
      <Section title="Üst bilgi (her sayfada)">
        <TextBox label="Sol" value={s.ustBilgi.sol} onChange={(v) => set({ ustBilgi: { ...s.ustBilgi, sol: v } })} />
        <TextBox label="Orta" value={s.ustBilgi.orta} onChange={(v) => set({ ustBilgi: { ...s.ustBilgi, orta: v } })} />
        <TextBox label="Sağ" value={s.ustBilgi.sag} onChange={(v) => set({ ustBilgi: { ...s.ustBilgi, sag: v } })} />
      </Section>
      <Section title="Alt bilgi">
        <p className="text-[11px] text-muted-foreground">Sol-alt köşe belge künyesine ayrılmıştır; seçilemez.</p>
        <TextBox label="Orta" value={s.altBilgi.orta} onChange={(v) => set({ altBilgi: { ...s.altBilgi, orta: v } })} />
        <TextBox label="Sağ" value={s.altBilgi.sag} onChange={(v) => set({ altBilgi: { ...s.altBilgi, sag: v } })} />
      </Section>
      <Section title="Sayfa numarası">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Sayfa no konumu">
          {PAGE_NUMBER_POSITIONS.map((p) => (
            <button key={p.value} type="button" aria-pressed={s.sayfaNo.konum === p.value} className={seg(s.sayfaNo.konum === p.value)} onClick={() => set({ sayfaNo: { ...s.sayfaNo, konum: p.value } })}>{p.label}</button>
          ))}
        </div>
        <TextBox label="Biçim ({n} = sayfa, {N} = toplam)" value={s.sayfaNo.bicim} onChange={(v) => set({ sayfaNo: { ...s.sayfaNo, bicim: v } })} />
        <p className="text-[11px] text-muted-foreground">Görünüm: {pageNumberPreview(s.sayfaNo.bicim)}</p>
        <label className="flex items-center justify-between text-xs">
          İlk sayfa farklı (üst/alt bilgisiz)
          <Switch checked={s.ilkSayfaFarkli} onCheckedChange={(v: boolean) => set({ ilkSayfaFarkli: v })} aria-label="İlk sayfa farklı" />
        </label>
      </Section>
      {issues.length > 0 && (
        <ul className="space-y-1 px-3 py-2 text-xs text-destructive" role="alert">
          {issues.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}
