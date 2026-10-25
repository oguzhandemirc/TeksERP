import { Lock } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DocumentAdvancedControls } from "@/pages/GeneralSettings/DocumentAdvancedControls";
import { DocumentFieldsPanel } from "@/pages/GeneralSettings/DocumentFieldsPanel";
import { DocumentStyleControls } from "@/pages/GeneralSettings/DocumentStyleControls";
import { DOC_DEF_MAP, DOC_TYPE_TO_KEY, resolveDocConfig, type DocumentConfig } from "@/services/documentConfig";
import { LANGUAGE_LOCK_NOTE, STYLE_MOVED_NOTE } from "../binding/docSettings";
import type { DesignerDraft } from "../useDesignerDraft";
import { Section } from "./Section";

/**
 * "Belge ayarları": şablon sürümüne DONDURULMUŞ `ayar` (plan P-d). GeneralSettings
 * bileşenleri `cfg/patch` sarmalayıcısıyla kullanılır (kopya yok). D8: düzenlenebilen
 * yalnız sözleşme ayarları (bölüm/kolon, imza); stil şablonun CSS'ine taşındığı için salt-okunur.
 */
export function DocumentSettingsPanel({ draft }: { draft: DesignerDraft }) {
  const key = DOC_TYPE_TO_KEY[draft.docType];
  const def = key ? DOC_DEF_MAP[key] : undefined;
  if (!key || !def) {
    return <p className="p-3 text-xs text-muted-foreground">Bu belge türünün ayarlanabilir belge ayarı yok.</p>;
  }
  const cfg = draft.settings as DocumentConfig;
  const resolved = resolveDocConfig({ [key]: cfg }, key);
  const patch = (next: Partial<DocumentConfig>) => draft.patchSettings(next as Record<string, unknown>);
  const labels = def.defaultSignatures.map((d, i) => cfg.signatureLabels?.[i] ?? d);
  const noop = () => undefined;

  return (
    <div data-testid="belge-ayarlari">
      <div className="space-y-2 px-3 pt-3">
        <Callout tone="info" title="Bu şablona özel">Ayarlar bu şablonun sürümüne dondurulur; Genel Ayarlar'daki değişiklik bu şablonu etkilemez. Değişiklik taslağa düşer, kaydedilince yeni sürüm olur.</Callout>
      </div>
      <Section title="Belge dili" testId="dil-kilidi">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Türkçe</span>
          <span className="text-xs text-muted-foreground">(kilitli)</span>
        </div>
        <p className="text-xs text-muted-foreground">{LANGUAGE_LOCK_NOTE}</p>
        {draft.languageWarnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
      </Section>
      <Section title="İmza alanı">
        <label className="flex items-center justify-between text-xs">
          İmza kutularını bas
          <Switch checked={resolved.showSignatures} onCheckedChange={(v: boolean) => patch({ showSignatures: v })} aria-label="İmza kutularını bas" />
        </label>
        {resolved.showSignatures && labels.map((l, i) => (
          <Input key={i} className="h-8 text-xs" aria-label={`İmza etiketi ${i + 1}`} value={l} maxLength={40} onChange={(e) => patch({ signatureLabels: labels.map((x, j) => (j === i ? e.target.value : x)) })} />
        ))}
      </Section>
      <div className="space-y-4 px-3 py-3">
        <DocumentFieldsPanel def={def} cfg={cfg} resolved={resolved} disabled={false} patch={patch} />
      </div>
      <Section title="Stil ve gelişmiş (salt-okunur)">
        <p className="text-xs text-muted-foreground">{STYLE_MOVED_NOTE}</p>
        <div className="pointer-events-none space-y-4 opacity-60" aria-disabled>
          <DocumentStyleControls cfg={cfg} disabled patch={noop} />
          <DocumentAdvancedControls def={{ ...def, supportsLanguage: false }} cfg={cfg} disabled patch={noop} />
        </div>
      </Section>
    </div>
  );
}
