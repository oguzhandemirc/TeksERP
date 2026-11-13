// Kart yolunun (`POST /api/customers`) OPSİYONEL `clientToken` replay'i (V4c, patron telefonu): ağ kopup yeniden
// denenen doğuş 409 `CUSTOMER_NAME_DUPLICATE` yerine ilk kaydı döndürür. Token yoksa `CustomerService.create` AYNEN.
// Kart servisi 300 satır sınırında olduğundan ayrı dosyada; doğum `CustomerService` yöntemlerinden (hızlı kayıtla aynı dikiş).
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { readCustomerFinance, type CustomerFinanceInput } from "./helpers/customer-finance-bridge.helper";
import type { CustomerService } from "./customer.service";

/** Gelen vergi no'yu kayıttaki biçime indirger (boş → null); geçersiz biçim zaten doğuşta 400'dür, burada yalnız kıyas. */
function taxKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/** Kart doğuşunun replay politikası: kimlik = katlanmış ad + vergi no; pasife alınan/birleştirilen kart 4. durumdur (409). */
function cardCreateReplay(name: unknown, taxNumber: unknown, load: (id: string) => Promise<ApiResponse<unknown>>) {
  return tokenReplay<{ id: string; name: string; taxNumber: string | null; isActive: boolean; mergedIntoId: string | null }, ApiResponse<unknown>>({
    find: (db, token) => db.customer.findUnique({ where: { clientToken: token }, select: { id: true, name: true, taxNumber: true, isActive: true, mergedIntoId: true } }),
    alive: (p) => {
      if (p.isActive && !p.mergedIntoId) return;
      throw AppError.conflict("Bu cari kaydı oluşturulduktan sonra pasife alınmış ya da birleştirilmiş — cariyi listeden seçin.", { code: "CUSTOMER_CREATE_GONE", customerId: p.id });
    },
    identity: (p) => [
      { ad: "ad", mevcut: foldNameForCompare(p.name), gelen: foldNameForCompare(typeof name === "string" ? name : "") },
      { ad: "vergiNo", mevcut: p.taxNumber, gelen: taxKey(taxNumber) },
    ],
    collision: "Bu işlem kimliği başka bir cari kaydına ait; formu kapatıp yeniden açın.",
    respond: (p) => load(p.id),
  });
}

/** İlk doğuşun yanıt biçimi (`finishCardCreate`: kart + `cariAccountId`) — replay aynı şekli verir. */
async function loadAsBorn(svc: CustomerService, id: string): Promise<ApiResponse<unknown>> {
  const base = await svc.findById(id);
  if (!base.success) return base;
  const finance = await readCustomerFinance(id);
  return { ...base, data: { ...(base.data as Record<string, unknown>), cariAccountId: finance?.cariAccountId ?? null }, message: "Kayıt zaten oluşturulmuş" };
}

export async function createCustomerCard(
  svc: CustomerService,
  data: Record<string, unknown>,
  userId: string | undefined,
  opts: { finance: CustomerFinanceInput | null; clientToken?: string },
): Promise<ApiResponse<unknown>> {
  const { clientToken } = opts;
  if (!clientToken) return svc.create(data, userId, { finance: opts.finance });
  // Kimlik `prepareCardCreate` gövdeyi değiştirmeden ÖNCE yakalanır.
  const replay = cardCreateReplay(data.name, data.taxNumber, (id) => loadAsBorn(svc, id));
  return replay.run(clientToken, async () => {
    const plan = svc.prepareCardCreate(data);
    return svc.withCardCreateRetry(data, async () => {
      const born = await prisma.$transaction((tx) => svc.createCardInTx(tx, plan, userId, { clientToken }));
      return svc.finishCardCreate(born, userId, { finance: opts.finance });
    });
  });
}
