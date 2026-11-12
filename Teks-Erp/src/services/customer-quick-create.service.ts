// Belgeden İE formunun HIZLI müşteri kaydı (Gülkesim 2026-11-04): ad (+ seçicinin "Diğer" iletişim alanları, 2026-11-10),
// rol yalnız Müşteri. Kart yolu `create` ile AYNI (kod, ad/vergi no seddi 409, cari hesap, audit); `clientToken` replay'i
// tek boğazdan (R kipi). Kart servisi 300 satır sınırında olduğundan ayrı dosyada; doğum `CustomerService` yöntemlerinden.
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import type { CustomerService } from "./customer.service";

/** Hızlı kaydın replay politikası: kimlik = katlanmış ad; pasife alınan/birleştirilen kart 4. durumdur (409). */
function quickCreateReplay(name: string, load: (id: string) => Promise<ApiResponse<unknown>>) {
  return tokenReplay<{ id: string; name: string; isActive: boolean; mergedIntoId: string | null }, ApiResponse<unknown>>({
    find: (db, token) => db.customer.findUnique({ where: { clientToken: token }, select: { id: true, name: true, isActive: true, mergedIntoId: true } }),
    alive: (p) => {
      if (p.isActive && !p.mergedIntoId) return;
      throw AppError.conflict("Bu müşteri kaydı oluşturulduktan sonra pasife alınmış ya da birleştirilmiş — müşteriyi listeden seçin.", { code: "CUSTOMER_QUICK_CREATE_GONE", customerId: p.id });
    },
    identity: (p) => [{ ad: "ad", mevcut: foldNameForCompare(p.name), gelen: foldNameForCompare(name) }],
    collision: "Bu işlem kimliği başka bir müşteri kaydına ait; kaydı yeniden deneyin.",
    respond: (p) => load(p.id),
  });
}

/** Seçicinin "Diğer" bölümündeki opsiyonel kart alanları — route Zod'u yalnız bunları geçirir. */
export type QuickCreateExtra = Partial<Record<"taxNumber" | "contactName" | "contactPhone" | "email" | "city" | "district" | "address" | "notes", string>>;

export async function quickCreate(svc: CustomerService, input: { name: string; clientToken: string } & QuickCreateExtra, userId: string | undefined): Promise<ApiResponse<unknown>> {
  const { name, clientToken, ...extra } = input;
  const data: Record<string, unknown> = { ...extra, name, isCustomerRole: true };
  return quickCreateReplay(name, (id) => svc.findById(id)).run(clientToken, async () => {
    const plan = svc.prepareCardCreate(data);
    return svc.withCardCreateRetry(data, async () => {
      const born = await prisma.$transaction((tx) => svc.createCardInTx(tx, plan, userId, { clientToken }));
      return svc.finishCardCreate(born, userId, { finance: null, auditExtra: { source: "GELEN_BELGE_FORM" } });
    });
  });
}
