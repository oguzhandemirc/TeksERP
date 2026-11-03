import { useQuery } from "@tanstack/react-query";
import { getMenuLayout } from "@/services/menuLayoutService";
import { toMenuLayoutState, type MenuLayoutState } from "@/lib/menu-layout";

export const MENU_LAYOUT_QUERY_KEY = ["menu-layout"] as const;

/** Ham görünüm (Menü Düzeni ekranı). */
export function useMenuLayoutQuery() {
  return useQuery({ queryKey: MENU_LAYOUT_QUERY_KEY, queryFn: getMenuLayout, staleTime: 5 * 60 * 1000 });
}

/** Menü süzgeç durumu; yüklenmeden/hata/eski sunucu (404) → boş = bugünkü menü (fail-open, zararsız). */
export function useMenuLayout(): MenuLayoutState {
  return toMenuLayoutState(useMenuLayoutQuery().data);
}
