// Menü Düzeni taslağı (K19): sunucu değeri üstünde yerel değişiklik; Kaydet'e kadar yazılmaz, gövde yalnız değişen alan.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateMenuLayout, type MenuLayoutView } from "@/services/menuLayoutService";
import { MENU_LAYOUT_QUERY_KEY } from "@/hooks/useMenuLayout";
import { presetPreview, sameKeySet } from "./menu-layout-tree";

export type MenuPreset = MenuLayoutView["presets"][number];

export function useMenuLayoutDraft(server: MenuLayoutView | undefined) {
  const qc = useQueryClient();
  const [draftHidden, setDraftHidden] = useState<Set<string> | null>(null);
  const [draftAdvanced, setDraftAdvanced] = useState<boolean | null>(null);
  const [pendingPreset, setPendingPreset] = useState<MenuPreset | null>(null);
  const hidden = draftHidden ?? new Set(server?.hiddenScreens ?? []);
  const advanced = draftAdvanced ?? server?.advancedGroup ?? false;
  const unhideable = useMemo(() => new Map((server?.unhideable ?? []).map((u) => [u.key, u.reason])), [server]);
  const advancedSet = useMemo(() => new Set(server?.advancedScreens ?? []), [server]);
  const hiddenChanged = !!server && !sameKeySet(hidden, server.hiddenScreens);
  const advancedChanged = !!server && advanced !== server.advancedGroup;
  const reset = () => {
    setDraftHidden(null);
    setDraftAdvanced(null);
  };

  const save = useMutation({
    mutationFn: () =>
      updateMenuLayout({
        ...(hiddenChanged ? { hiddenScreens: [...hidden] } : {}),
        ...(advancedChanged ? { advancedGroup: advanced } : {}),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(MENU_LAYOUT_QUERY_KEY, saved);
      reset();
      toast.success("Menü düzeni kaydedildi.");
    },
    // Hata toast'ını apiClient interceptor basar (4xx backend mesajı) — ikinci toast yok.
  });

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraftHidden(next);
  };
  const preview = pendingPreset ? presetPreview(pendingPreset, hidden, new Set(unhideable.keys())) : [];
  const applyPreset = () => {
    const next = new Set(hidden);
    for (const s of preview) next.add(s.key);
    setDraftHidden(next);
    setPendingPreset(null);
  };

  return {
    hidden, advanced, unhideable, advancedSet, dirty: hiddenChanged || advancedChanged, save, reset, toggle,
    showAll: () => setDraftHidden(new Set()), setAdvanced: setDraftAdvanced,
    pendingPreset, setPendingPreset, preview, applyPreset,
  };
}
