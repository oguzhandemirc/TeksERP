// =============================================================================
// MODAL BÖLÜM GÖRÜNÜRLÜĞÜ — kullanıcının modalda gizlediği bölümler (2026-11-19)
// =============================================================================
// Kayıt kullanıcı tercih blob'unda (`prefs.modalSections[modalId]` = gizli bölüm id listesi); varsayılan
// = her şey görünür, bu yüzden kayıt yalnız SAPMAYI taşır ve boş liste anahtarı siler. Zorunlu alanlı ya da
// hatalı bölüm kayıtta gizli olsa da görünür (gizli zorunlu alan formu sessizce kilitlerdi).
// =============================================================================
import { useCallback, useState } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";

/** Bozuk/eski kayıt modalı kilitlemez: yalnız boş olmayan metin id'ler, tekrarsız. */
export function readHiddenSections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && v.trim() !== ""))];
}

export function withHidden(list: readonly string[], id: string, hidden: boolean): string[] {
  const rest = list.filter((x) => x !== id);
  return hidden ? [...rest, id] : rest;
}

/** Etkin görünürlük: kayıtta gizli VE kilitsiz (zorunlu değil, hatasız) ise gizli. */
export function isSectionHidden(hidden: readonly string[], id: string, locked: boolean): boolean {
  return !locked && hidden.includes(id);
}

/** Sağlayıcı varsa sunucu tercihine, yoksa (izole bileşen testi) bellek içine yazar. */
export function useModalSectionPrefs(modalId: string) {
  const ctx = useOptionalPreferences();
  const [local, setLocal] = useState<string[]>([]);
  const hidden = ctx ? readHiddenSections(ctx.prefs.modalSections?.[modalId]) : local;
  const setPreference = ctx?.setPreference;

  const write = useCallback(
    (update: (cur: string[]) => string[]) => {
      if (!setPreference) return setLocal((cur) => update(cur));
      setPreference((cur) => {
        const all = { ...(cur.modalSections ?? {}) };
        const next = update(readHiddenSections(all[modalId]));
        if (next.length === 0) delete all[modalId];
        else all[modalId] = next;
        return { modalSections: all };
      });
    },
    [setPreference, modalId],
  );

  const setHidden = useCallback((id: string, h: boolean) => write((cur) => withHidden(cur, id, h)), [write]);
  const reset = useCallback(() => write(() => []), [write]);
  return { hidden, setHidden, reset };
}
