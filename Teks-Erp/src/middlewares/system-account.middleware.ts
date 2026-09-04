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
 * EN YETKİLİ HESAP YAZMAYA KAPALI — başkası onu DEĞİŞTİREMEZ.
 *
 * ⚠️ 2026-09-04 (ikinci tur). Gizleme kaldırılırken eski `blockSystemAccountTarget`
 * TAMAMEN silinmişti; oysa o kapı `/users/:id` altındaki **13 YAZMA UCUNU** da
 * kapatıyordu ve o iş gizlilikle ilgili DEĞİLDİ. Silinince `admin:users` taşıyan
 * biri en yetkili hesabın:
 *   · parolasını sıfırlayabiliyordu (`reset-password`)
 *   · PIN / kart jetonu atayabiliyordu (`quick-pin`, `card-token`) → o kimliğe
 *     bürünmenin en kısa yolu (`login-quick-pin` PIN'i TEK BAŞINA kimlik sayar)
 *   · 2FA'sını sıfırlayabiliyordu (`totp/reset`)
 *   · hesabı pasifleştirebiliyor / SİLEBİLİYORDU
 * Yetki LİSTESİ zaten dokunulmazdı (`getEffectivePermissions` grant satırlarını
 * OKUMADAN `["*"]` döner), ama hesabı DEVRALMAK yetkiyi değiştirmekten kötüdür.
 *
 * OKUMA SERBEST: `GET` geçer. Karar buydu — hesap her yüzeyde görünür olacak.
 * Tek istisna `GET /credentials` (düz PIN) ve onun kendi dar kapısı var.
 *
 * KENDİSİ MUAF: `req.isSystemAccount === true` ise geçer (kendi hesabını yönetir).
 *
 * 403, 404 DEĞİL: hesabın varlığı artık açık; yanlış bilgi vermenin anlamı yok.
 */
export async function protectSystemAccountTarget(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.method === "GET") {
      next();
      return;
    }
    if (req.isSystemAccount === true) {
      next();
      return;
    }
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
      action: "SYSTEM_ACCOUNT_WRITE_BLOCKED",
      userId: req.user?.userId ?? null,
      tableName: "users",
      recordId: id,
      // ⚠️ SIR YOK: yalnız hedef id + hangi uç denendi.
      payload: { targetUserId: id, method: req.method, path: req.originalUrl },
    }).catch(() => undefined);
    next(
      AppError.forbidden(
        "En yetkili hesap başka bir kullanıcı tarafından değiştirilemez.",
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * EN YETKİLİ HESABA ÖZEL YÜZEY KAPISI: istek sahibi o hesap değilse **403**
 * (2026-09-03 / P3 — ayar şifresi yönetimi).
 *
 * ⚠️ 2026-09-04: eskiden **404** dönüyordu. Gerekçe "403 hesabın VARLIĞINI
 * doğrular" idi; hesap artık her yüzeyde GÖRÜNÜR olduğu için o gerekçe çürüdü
 * ve 404 yalnızca yetkisiz kullanıcıya yanlış bilgi veren bir gürültü olarak
 * kalmıştı ("böyle bir uç yok" — oysa var).
 *
 * ⚠️ `verifyToken`DAN SONRA takılır: kimliksiz istek 401 almalıdır.
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
    next(AppError.forbidden("Bu işlem için en yetkili hesap gerekir"));
    return;
  }
  next();
}
