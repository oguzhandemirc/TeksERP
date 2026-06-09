import { createContext, useContext } from "react";

/**
 * Bu sekmenin kök DOM kutusu (modal/sheet portallarının hedefi). Modaller
 * `document.body` yerine buraya portallanırsa: karartma yalnız bu sekmeyi kaplar,
 * sekme değişince modal sekmeyle birlikte gizlenir (mount kaldığı için state
 * korunur) ve sekme barı/sidebar tıklanabilir kalır.
 *
 * Varsayılan `null` — sekme sistemi dışında render edilen yerler (login, komut
 * paleti, AppShell seviyesi diyaloglar) klasik tam-ekran modal davranışını sürdürür.
 */
const TabPortalContext = createContext<HTMLElement | null>(null);

export const TabPortalProvider = TabPortalContext.Provider;

/** İçeriğin bulunduğu sekmenin portal container'ı (yoksa `null`). */
export function useTabPortalContainer(): HTMLElement | null {
  return useContext(TabPortalContext);
}
