// =============================================================================
// TeksERP - FabricProperty (Kumaş Özellik) Service (extends BaseService)
// =============================================================================
// Override: create → `code` backend-authoritative `OZL + GGAAYY + NNNN` (günlük
// sıralı). İstemciden gelen `code` YOK SAYILIR — Özellikler sayfası + özellik
// hızlı-ekleme aynı formatı alsın (CustomerService deseniyle birebir).
// =============================================================================

import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import prisma from "../lib/prisma";
import { dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";

/** Özellik kodu prefix'i — tek-tip kod formatı: `OZL + GGAAYY + NNNN`. */
const PROPERTY_CODE_PREFIX = "OZL";

/**
 * Sıradaki özellik kodu: `OZL + GGAAYY + NNNN` (gün başına 1'den artan, 4 hane).
 * collation-güvenli sorgu (gte + startsWith) + sayısal max+1 — müşteri/sevkiyat/
 * çuval kodlarıyla aynı kalıp ([[code-format]]). Çakışma withBarcodeRetry ile telafi.
 */
async function nextPropertyCode(): Promise<string> {
  const prefix = dailyCodePrefix(PROPERTY_CODE_PREFIX);
  const todays = await prisma.fabricProperty.findMany({
    where: { code: { gte: prefix, startsWith: prefix } },
    select: { code: true },
  });
  const seq = nextDailySeq(
    todays.map((p) => p.code),
    prefix,
  );
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export class FabricPropertyService extends BaseService {
  /**
   * Özellik kodu backend-authoritative: her zaman `OZL+GGAAYY+NNNN` günlük sıralı
   * üretilir; istemciden gelen `code` YOK SAYILIR. Eşzamanlı iki create aynı sıra
   * no'yu okuyup INSERT'te @unique çakışırsa (P2002) withBarcodeRetry taze no ile
   * yeniden dener. (Müşteri kodu deseniyle birebir — bkz. customer.service.ts.)
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return withBarcodeRetry(async () => {
      data.code = await nextPropertyCode();
      return super.create(data, userId);
    });
  }
}
