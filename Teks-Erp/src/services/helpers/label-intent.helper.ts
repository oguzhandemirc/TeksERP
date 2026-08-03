// =============================================================================
// TeksERP — ETİKET NİYETİ ÇÖZÜMLEYİCİSİ (ortak yardımcı)
// =============================================================================
// "Bu top KİME?" sorusunun tek çözüm noktası. Gevşek modelde top→sipariş BAĞI
// yoktur: müşteri/sipariş yalnız **baskı-anı bağlamıdır** ve topun
// `lastLabelSnapshot`'ında minimal bir literal olarak yaşar
// (`{orderLineId}` | `{customerId}` | `{stock:true}`).
//
// NEDEN AYRI DOSYA: aynı çözüm (var-mı + müşteri isActive kontrolü) artık iki
// bağımsız yerden çağrılıyor — Tambur KESİMİ (`tambur.service`: cutWarehouseRoll /
// cutOpenFabric) ve Tambur MANUEL ÜRETİMİ (`tambur-manual.service`). Kopyalanmış
// ikinci bir çözümleyici, "pasif müşteri etikete atanamaz" guard'ının yalnız bir
// yolda yaşamasıyla biterdi; sessiz ayrışma tam olarak bu şekilde doğuyor.
//
// DB okuması tx DIŞINDA yapılır (tx içi I/O yasak — CLAUDE.md perf kuralı 10);
// çağıran önce snapshot'ı çözer, sonra transaction'ı açar.
// =============================================================================

import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildIntentSnapshot } from "../label.service";

/** Operatörün "Kime?" seçimi — ikisi de boş = stok (müşterisiz üretim). */
export interface LabelIntentInput {
  targetOrderLineId?: string | null;
  targetCustomerId?: string | null;
}

/** Çözülmüş niyet — `buildIntentSnapshot`'ın girdi şekli. */
export interface ResolvedLabelIntent {
  orderLineId?: string;
  customerId?: string;
  stock?: boolean;
}

/**
 * Hedef sipariş kalemi / müşteri var-mı + (müşteri) `isActive` doğrular.
 * Sipariş kalemi müşteriye ÖNCELİKLİDİR (kalem zaten bir müşteriye bağlıdır).
 * Hiçbiri verilmemişse `{ stock: true }`.
 *
 * Hata gövdeleri makine-okunur `code` taşır (mobil onu okur) — mesajlar
 * `tambur.service`in eski yerel kopyasıyla BİREBİR aynıdır, yalnız `details.code`
 * eklendi (additive; mevcut istemciler mesajı okumaya devam eder).
 */
export async function resolveLabelIntent(data: LabelIntentInput): Promise<ResolvedLabelIntent> {
  if (data.targetOrderLineId) {
    const ol = await prisma.orderLine.findUnique({
      where: { id: data.targetOrderLineId },
      select: { id: true },
    });
    if (!ol) {
      throw AppError.badRequest("Hedef sipariş kalemi bulunamadı", {
        code: "ORDER_LINE_NOT_FOUND",
      });
    }
    return { orderLineId: ol.id };
  }
  if (data.targetCustomerId) {
    const cust = await prisma.customer.findUnique({
      where: { id: data.targetCustomerId },
      select: { id: true, isActive: true },
    });
    if (!cust) {
      throw AppError.badRequest("Hedef müşteri bulunamadı", { code: "CUSTOMER_NOT_FOUND" });
    }
    if (!cust.isActive) {
      throw AppError.badRequest("Hedef müşteri pasif — etikete atanamaz", {
        code: "CUSTOMER_INACTIVE",
      });
    }
    return { customerId: cust.id };
  }
  return { stock: true };
}

/** `resolveLabelIntent` + `buildIntentSnapshot` — `lastLabelSnapshot`'a yazılacak JSON. */
export async function resolveLabelIntentSnapshot(
  data: LabelIntentInput,
): Promise<Prisma.InputJsonValue> {
  return buildIntentSnapshot(await resolveLabelIntent(data));
}
