// Renk (`POST /api/colors`) ve ürün kartı (`POST /api/items`) doğuşunun OPSİYONEL `clientToken` replay'i (V5c, patron
// telefonu): ağ kopup yeniden denenen doğuş ad mükerreri 409'u yerine ilk kaydı döndürür. Token yoksa servis AYNEN.
// Servisler satır sınırında olduğundan ayrı dosyada; doğum servislerin kendi `create`inden (token sistem alanı olarak).
import { z } from "zod";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import type { BaseService } from "./base.service";

/** Doğuş gövdesinden opsiyonel deneme kimliğini alır (gövdeden siler); geçersiz biçim 400, yoksa undefined. */
export function takeCreateToken(body: Record<string, unknown> | undefined): string | undefined {
  if (!body || !("clientToken" in body)) return undefined;
  const token = z.string().uuid("Geçersiz işlem kimliği").optional().parse(body.clientToken ?? undefined);
  delete body.clientToken;
  return token;
}

type Prior = { id: string; name: string; isActive: boolean; mergedIntoId: string | null };
const PRIOR_SELECT = { id: true, name: true, isActive: true, mergedIntoId: true } as const;

/** 4. durum: kayıt sonradan pasife alındı ya da birleştirildi → ilk kaydı dönmek yanlış cevap olur (409). */
function aliveOr(code: string, label: string) {
  return (p: Prior): void => {
    if (p.isActive && !p.mergedIntoId) return;
    throw AppError.conflict(`Bu ${label} kaydı oluşturulduktan sonra pasife alınmış ya da birleştirilmiş — listeden seçin.`, { code, recordId: p.id });
  };
}

async function loadAsBorn(svc: BaseService, id: string): Promise<ApiResponse<unknown>> {
  const res = await svc.findById(id);
  return res.success ? { ...res, message: "Kayıt zaten oluşturulmuş" } : res;
}

/** Renk doğuşunun replay politikası: kimlik = katlanmış ad (renk katlaması: ayraç-duyarsız, rakam önce). */
function colorCreateReplay(svc: BaseService, name: unknown) {
  return tokenReplay<Prior, ApiResponse<unknown>>({
    find: (db, token) => db.color.findUnique({ where: { clientToken: token }, select: PRIOR_SELECT }),
    alive: aliveOr("COLOR_CREATE_GONE", "renk"),
    identity: (p) => [{ ad: "ad", mevcut: foldColorNameForCompare(p.name), gelen: foldColorNameForCompare(typeof name === "string" ? name : "") }],
    collision: "Bu işlem kimliği başka bir renk kaydına ait; formu kapatıp yeniden açın.",
    respond: (p) => loadAsBorn(svc, p.id),
  });
}

/** Ürün kartı doğuşunun replay politikası: kimlik = katlanmış ad + tür. */
function itemCreateReplay(svc: BaseService, name: unknown, itemType: unknown) {
  return tokenReplay<Prior & { itemType: string }, ApiResponse<unknown>>({
    find: (db, token) => db.item.findUnique({ where: { clientToken: token }, select: { ...PRIOR_SELECT, itemType: true } }),
    alive: aliveOr("ITEM_CREATE_GONE", "ürün"),
    identity: (p) => [
      { ad: "ad", mevcut: foldNameForCompare(p.name), gelen: foldNameForCompare(typeof name === "string" ? name : "") },
      { ad: "tur", mevcut: p.itemType, gelen: typeof itemType === "string" ? itemType : null },
    ],
    collision: "Bu işlem kimliği başka bir ürün kaydına ait; formu kapatıp yeniden açın.",
    respond: (p) => loadAsBorn(svc, p.id),
  });
}

type ColorCreate = BaseService & { create(data: Record<string, unknown>, userId?: string, opts?: { clientToken?: string }): Promise<ApiResponse<unknown>> };
type ItemCreate = BaseService & { create(data: Record<string, unknown>, userId: string | undefined, opts?: { clientToken?: string }): Promise<ApiResponse<unknown>> };

export async function createColorRecord(svc: ColorCreate, data: Record<string, unknown>, userId: string | undefined, clientToken?: string): Promise<ApiResponse<unknown>> {
  if (!clientToken) return svc.create(data, userId);
  // Kimlik servis gövdeyi normalize etmeden ÖNCE yakalanır.
  return colorCreateReplay(svc, data.name).run(clientToken, () => svc.create(data, userId, { clientToken }));
}

export async function createItemRecord(svc: ItemCreate, data: Record<string, unknown>, userId: string | undefined, clientToken?: string): Promise<ApiResponse<unknown>> {
  if (!clientToken) return svc.create(data, userId);
  return itemCreateReplay(svc, data.name, data.itemType).run(clientToken, () => svc.create(data, userId, { clientToken }));
}
