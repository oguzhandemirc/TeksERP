// =============================================================================
// Müşteri barkodu eksik-kod kapısı (D4-F3; `label.customerCodeMissing`) — TEK KARAR NOKTASI
// =============================================================================
// Şablonun bir qr/code128 elemanı `source: CUSTOMER_CODE` ise ve topun aktif müşteri
// kodu yoksa: BLOCK → 400 `CUSTOMER_CODE_MISSING` (render'dan ÖNCE atılır → kâğıt ve
// `print_jobs` satırı doğmaz) · ROLL_BARCODE → o elemanlar iç barkodu basar + uyarı.
// CUSTOMER_CODE elemanı olmayan şablonda (bugünkü HER şablon) hiçbir şey yapmaz.
// =============================================================================
import type { LabelTemplateVariant } from "@prisma/client";
import { fallbackCustomerCodeToRoll, layoutUsesCustomerCode, readCanvasLayout } from "../../config/label-elements";
import type { LabelPayload } from "../../types/label.types";
import { AppError } from "../../utils/app-error";
import { readLabelCustomerCodeMissing } from "../system-setting.service";

export const CUSTOMER_CODE_MISSING = "CUSTOMER_CODE_MISSING";
export const CUSTOMER_CODE_FALLBACK_WARNING = "Topa bağlı müşteri barkodu yok — etikete iç top barkodu basıldı.";

export interface CustomerCodeGateResult {
  variant: LabelTemplateVariant | null;
  warnings: string[];
}

export async function applyCustomerCodeGate(
  payload: Pick<LabelPayload, "customerCode" | "barcode">,
  variant: LabelTemplateVariant | null,
): Promise<CustomerCodeGateResult> {
  const layout = readCanvasLayout(variant?.elements);
  if (!variant || !layoutUsesCustomerCode(layout) || payload.customerCode) return { variant, warnings: [] };
  const mode = await readLabelCustomerCodeMissing();
  if (mode === "BLOCK") {
    throw AppError.badRequest(
      `Bu topa müşteri barkodu bağlanmamış (${payload.barcode ?? "barkodsuz"}); şablon müşteri barkodu basıyor. Önce müşteri etiketini okutup bağlayın.`,
      { code: CUSTOMER_CODE_MISSING },
    );
  }
  const elements = fallbackCustomerCodeToRoll(layout!);
  return { variant: { ...variant, elements: elements as unknown as LabelTemplateVariant["elements"] }, warnings: [CUSTOMER_CODE_FALLBACK_WARNING] };
}

/** ApiResponse'a yalnız uyarı varsa `warnings` ekler (tekilleştirilmiş; yoksa yanıt bayt-aynı). */
export function withWarnings(warnings: readonly string[]): { warnings?: string[] } {
  return warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {};
}
