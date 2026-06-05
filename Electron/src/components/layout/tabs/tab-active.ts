import { createContext, useContext } from "react";

/**
 * Bu sekme şu an aktif (görünür) mi? Açık sekmelerin hepsi mount kalır; pasifler
 * yalnız `invisible` ile gizlenir. Portala (document.body) taşınan overlay'ler
 * (Sheet/Dialog) bu gizlemeden kaçar ve aktif sekmenin üstüne biner. İçerik bu
 * context'i okuyup overlay'i yalnız kendi sekmesi aktifken açık tutabilir.
 *
 * Varsayılan `true` — sekme sistemi dışında render edilen sayfalar normal davranır.
 */
const TabActiveContext = createContext(true);

export const TabActiveProvider = TabActiveContext.Provider;

/** İçeriğin bulunduğu sekme şu an aktif/görünür mü? */
export function useIsTabActive(): boolean {
  return useContext(TabActiveContext);
}
