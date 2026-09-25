// =============================================================================
// CANLI KAYIT 409'U — arşiv kapısının kayıt listesini genel toast yerine diyalogda gösterir
// =============================================================================
// Backend: ürün `ITEM_HAS_LIVE_REFERENCES`, diğer ana veriler `MASTER_DATA_HAS_LIVE_REFERENCES`
// (`details.references` = tür tür kayıtlar). Toast yalnız cümleyi taşır, kayıtları düşürürdü
// (yıkıcı işlem kuralı: etkilenen kayıt tek tek). Diyalog App düzeyinde TEK mount; açılışı
// kayıtlı bir "gösterici" tetikler (`settings-password` emsali).
// =============================================================================
import type { LiveRefGroup } from "./item-lifecycle";

export const LIVE_REFERENCE_CODES: readonly string[] = ["ITEM_HAS_LIVE_REFERENCES", "MASTER_DATA_HAS_LIVE_REFERENCES"];

export interface LiveReferencesNotice {
  message: string;
  references: LiveRefGroup[];
}

type Presenter = (notice: LiveReferencesNotice) => void;
let presenter: Presenter | null = null;

export function registerLiveReferencesPresenter(fn: Presenter | null): void {
  presenter = fn;
}

/** Hata gövdesi kayıt listeli bir arşiv 409'uysa gösterir ve `true` döner (çağıran toast basmaz). */
export function presentLiveReferences(body: unknown): boolean {
  const b = body as { message?: string; details?: { code?: unknown; references?: unknown } } | undefined;
  const code = b?.details?.code;
  const refs = b?.details?.references;
  if (!presenter || typeof code !== "string" || !LIVE_REFERENCE_CODES.includes(code) || !Array.isArray(refs)) return false;
  presenter({ message: b?.message ?? "", references: refs as LiveRefGroup[] });
  return true;
}
