// =============================================================================
// TeksERP — SATICI HESABINI HEDEFLEYEN İSTEKLER: 404 (id sızıntısı → PIN zinciri)
// =============================================================================
// KAPATTIĞI ZİNCİR (ölçülmüş, iki adım):
//   1. Audit listesi satır başına aktörün `id`sini basar (karar #8 gereği satır
//      KALIR; gizlenen yalnız görünen ad). Yani sistem hesabının id'si, denetim
//      ekranını görebilen bir fabrika yöneticisinin elindedir.
//   2. `GET /api/admin/users/:id/credentials` o id'nin 6 haneli DÜZ PIN'ini ve
//      kart kodunu döner. PIN tek başına kimliktir (`login-quick-pin`) → yönetici
//      satıcının kimliğine bürünür ve sonraki her işlem audit'e "Sistem Bakımı"
//      adıyla yazılır.
//
// NEDEN 404, 403 DEĞİL: 403 hesabın VARLIĞINI doğrular. Uzak erişimdeki PIN/kart
// uçlarının `notFound` kararı (`auth.service.assertNotRemote`) ile aynı gerekçe:
// "bu kaynak var mı" sorusu cevapsız kalmalı.
//
// NEDEN ÖNEK (`router.use("/users/:id", …)`), route başına DEĞİL: bugün 17 uç
// var ve on sekizincisi yarın yazılacak. Önek kapısı YENİ ucu da kapsar —
// fail-closed by construction. Route başına eklemek, "unutulmuş altıncı yüzey"
// sınıfının tam olarak tekrar ettiği yerdir.
//
// ⚠️ BEDELİ BİLİNÇLİ: önek zincirinde `verifyToken` + `requirePermission` bir kez
// daha koşar (route'un kendi zinciri de onları taşır) → istek başına iki küçük
// indeksli sorgu FAZLADAN. Kabul edildi: bunlar düşük trafikli yönetim uçlarıdır
// ve alternatif (kimliksiz DB okuması) BİR ORAKÜL AÇARDI — kimliksiz bir istek
// sistem hesabı id'sinde 404, başkasında 401 alır, yani hesabın varlığı kimlik
// gerektirmeden sızardı.
//
// ⚠️ UUID OLMAYAN `:id` DOKUNULMADAN GEÇER: bugünkü davranış korunur (Prisma
// P2023 → mevcut hata yolu). Burada 400'e çevirmek kapının işi değil.
// =============================================================================

import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "../services/audit.service";
import "../types/express-augment";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hedef kullanıcı bir SİSTEM hesabıysa isteği 404'e düşürür ve denemeyi audit'e
 * yazar ("kim satıcı hesabının künyesini/PIN'ini aradı" sorusunun cevabı).
 */
export async function blockSystemAccountTarget(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Express 5: `req.params.id` tipi `string | string[]` (repo konvansiyonu: cast).
    const id = req.params.id as string | undefined;
    if (!id || !UUID_RE.test(id)) {
      next();
      return;
    }
    const target = await prisma.user.findUnique({
      where: { id },
      select: { isSystemAccount: true },
    });
    if (!target?.isSystemAccount) {
      next();
      return;
    }
    // BEST-EFFORT (audit sözleşmesi): yazım hatası isteği DÜŞÜRMEZ — ama istek
    // zaten reddedilecek, yani sessiz kalmak bilgiyi kaybetmek demek.
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SYSTEM_ACCOUNT_ACCESS_BLOCKED",
      userId: req.user?.userId ?? null,
      tableName: "users",
      recordId: id,
      // ⚠️ SIR YOK: yalnız hedef id + hangi uç denendi.
      payload: { targetUserId: id, method: req.method, path: req.originalUrl },
    }).catch(() => undefined);
    next(AppError.notFound("Kullanıcı bulunamadı"));
  } catch (error) {
    next(error);
  }
}

/**
 * SÜPERADMİN-ONLY YÜZEY KAPISI: istek sahibi sistem hesabı DEĞİLSE **404**
 * (2026-09-03 / P3 — ayar şifresi yönetimi).
 *
 * ⚠️ 403 DEĞİL, aynı gerekçeyle: 403 "böyle bir uç var ve sen yetkisizsin"
 * der, yani satıcı hesabının VARLIĞINI ve yönettiği yüzeyi doğrular. Fabrika
 * yöneticisi için bu uç hiç YOKTUR.
 *
 * ⚠️ `verifyToken`DAN SONRA takılır: kimliksiz istek 401 almalıdır. Kimliksiz
 * bir istek burada 404 alsaydı, "kimlik olmadan da 404" gözlemi ucun varlığını
 * ele veren ikinci bir orakül olurdu.
 *
 * ⚠️ Kimlik `req.isSystemAccount`tır — istek başına DB'den TAZE okunur
 * (`verifyToken`), JWT claim'i DEĞİL: istemci seçemez.
 */
export function requireSystemAccountOr404(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.isSystemAccount !== true) {
    next(AppError.notFound("Kayıt bulunamadı"));
    return;
  }
  next();
}
