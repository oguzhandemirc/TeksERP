import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_TRAVELER_CARD_CONFIG, type TravelerCardConfig } from "@/services/featureFlagService";
import {
  SECTION_KEYS,
  SECTION_LEGACY_FLAG,
  type SectionEntry,
  type SectionKey,
  type TravelerTemplate,
  type TravelerTemplateMode,
} from "./types";

export interface StudioDraft {
  name: string;
  mode: TravelerTemplateMode;
  config: TravelerCardConfig;
  html: string;
}

/** Kayıtlı şablon → düzenlenebilir taslak. */
function toDraft(tpl: TravelerTemplate | null): StudioDraft {
  return {
    name: tpl?.name ?? "",
    mode: tpl?.mode ?? "SECTIONS",
    config: { ...DEFAULT_TRAVELER_CARD_CONFIG, ...(tpl?.config ?? {}) },
    html: tpl?.html ?? "",
  };
}

/** `sections` yoksa varsayılan sıra (backend resolveSectionOrder ile aynı sözleşme). */
function readSections(config: TravelerCardConfig): SectionEntry[] {
  const raw = (config as { sections?: SectionEntry[] }).sections;
  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<string>();
  const out: SectionEntry[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || !known.has(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, enabled: s.enabled !== false });
  }
  for (const k of SECTION_KEYS) if (!seen.has(k)) out.push({ key: k, enabled: true });
  return out;
}

/**
 * Stüdyo taslağı — bölüm sırası, bölüm anahtarları, mod ve ham HTML.
 *
 * BÖLÜM ANAHTARI TEK GERÇEĞE YAZAR: eski görünürlük bayrağı olan bölümlerde
 * (Siparişler, Talimatlar, Partiler…) anahtar O BAYRAĞI değiştirir; bayrağı
 * olmayanlarda `sections[].enabled`i. Böylece stüdyo ile "Refakat Kartı
 * Ayarları" ekranı çelişmez — kullanıcı bir yerden kapatıp öbüründe açık
 * göremez.
 */
export function useStudioDraft(selected: TravelerTemplate | null) {
  const [draft, setDraft] = useState<StudioDraft>(() => toDraft(selected));
  const selectedKey = selected ? `${selected.id}:${selected.updatedAt}` : "new";

  // Seçili şablon değişince (ya da sunucudan tazelenince) taslağı eşitle.
  useEffect(() => {
    setDraft(toDraft(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const sections = useMemo(() => readSections(draft.config), [draft.config]);

  const isEnabled = useCallback(
    (key: SectionKey): boolean => {
      const entry = sections.find((s) => s.key === key);
      if (entry?.enabled === false) return false;
      const flag = SECTION_LEGACY_FLAG[key];
      if (!flag) return true;
      return draft.config[flag] !== false;
    },
    [sections, draft.config],
  );

  const setSections = useCallback((next: SectionEntry[]) => {
    setDraft((d) => ({ ...d, config: { ...d.config, sections: next } as TravelerCardConfig }));
  }, []);

  const toggleSection = useCallback(
    (key: SectionKey, next: boolean) => {
      const flag = SECTION_LEGACY_FLAG[key];
      setDraft((d) => {
        const current = readSections(d.config);
        // Bayraklı bölüm: eski bayrağı yaz VE entry.enabled'ı açık bırak
        // (ikisi AND'lendiği için kapalı kalan biri sessiz bir kilit olurdu).
        const nextSections = current.map((s) =>
          s.key === key ? { ...s, enabled: flag ? true : next } : s,
        );
        const nextConfig = { ...d.config, sections: nextSections } as TravelerCardConfig;
        // Eski görünürlük bayrağı her zaman boolean bir alan (showOrders,
        // showNotes…) — tip düzeyinde `TravelerCardConfig[flag]` genel bir
        // birleşim olduğu için atama unknown üzerinden yapılır.
        if (flag) (nextConfig as unknown as Record<string, boolean>)[flag] = next;
        return { ...d, config: nextConfig };
      });
    },
    [],
  );

  const patch = useCallback((p: Partial<StudioDraft>) => setDraft((d) => ({ ...d, ...p })), []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toDraft(selected)),
    [draft, selected],
  );

  return { draft, patch, sections, isEnabled, setSections, toggleSection, dirty };
}
