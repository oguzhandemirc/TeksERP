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

/**
 * İçeriğin bulunduğu sekmenin kimliği — sekme sistemi dışında (test, gömülü
 * kullanım) `null`. Geri tuşu bununla "bu sekmede geri gidilecek adım var mı?"
 * diye sorar (`history-depth.ts`); sekme kimliğini aktif sekmeden okumak yanlış
 * olurdu — pasif sekmeler de mount kalır ve kendi başlıklarını çizer.
 */
const TabIdContext = createContext<string | null>(null);

export const TabIdProvider = TabIdContext.Provider;

export function useTabId(): string | null {
  return useContext(TabIdContext);
}
