// K20: iş emri adının (TERIM.terbiyeIsEmri) panel tarafı rejim bağlayıcısı. Kaynak bayrak ucu
// (`featureFlagService.get`, saat dilimi emsali); son bilinen rejim yerelde saklanır ki modül düzeyi okumalar
// açılışta doğru adla kurulsun (`main.tsx` ilk import). Bilinmiyorsa bugünkü ad ("Terbiye İş Emri").
import { terimDokumaAyarla } from "./terim";

export const TERM_REGIME_STORAGE_KEY = "tekserp.terim.dokumaRejimi";
/** Rejim bayrak ucundan uygulandı — açılışta adı bayat çözülmüş sekme başlıkları bununla tazelenir (`store/tabs`). */
export const TERM_REGIME_EVENT = "tekserp:terim-rejimi";

/** Açılışta son bilinen rejimi uygular (bayrak ucu giriş ister; o gelene dek bu değer geçerlidir). */
export function applyStoredTermRegime(): void {
  try {
    const v = globalThis.localStorage?.getItem(TERM_REGIME_STORAGE_KEY);
    if (v === "0") terimDokumaAyarla(false);
    else if (v === "1") terimDokumaAyarla(true);
  } catch {
    /* depo erişilemez → bugünkü ad */
  }
}

/** Bayrak yanıtından etkin dokuma rejimini (`production ∧ dokuma`) uygular ve saklar. Alan yoksa dokunmaz. */
export function applyTermRegime(flags: { productionEnabled?: boolean; dokumaEnabled?: boolean } | null | undefined): boolean {
  if (!flags || typeof flags.dokumaEnabled !== "boolean") return false;
  const enabled = (flags.productionEnabled ?? true) && flags.dokumaEnabled;
  const changed = terimDokumaAyarla(enabled);
  try {
    globalThis.localStorage?.setItem(TERM_REGIME_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* saklanamazsa bir sonraki açılış bugünkü adla başlar */
  }
  // Her uygulamada (değişmese de): kalıcı sekme defteri önceki oturumdan bayat başlık taşıyabilir.
  globalThis.dispatchEvent?.(new Event(TERM_REGIME_EVENT));
  return changed;
}
