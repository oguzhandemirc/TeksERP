// =============================================================================
// ÇEK / SENET STORNO ROTALARI — ileri olayın tipli tersi
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `cheque.routes.ts` onu
// `router.use("/", chequeReversalRoutes)` ile bağlar ve oradaki
// `router.use(verifyToken, requireFinanceEnabled)` kapısını MİRAS ALIR; `app.ts`'e
// ayrıca bağlanırsa bayrak kapısı ya atlanır ya iki kez koşar.
//
// İzin `finance:cheque` — ileri geçişi yapan tersini de yapar (tahsil stornosu
// emsali). Sebep zorunlu; ters kayıt daima bugüne yazılır.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { chequeService } from "../services/cheque.service";

const router = Router();

const reversalBody = z
  .object({ reason: z.string().trim().min(1, "Storno için sebep zorunludur.").max(300) })
  .strict();

/**
 * @openapi
 * /api/finance/cheques/{id}/endorse-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Ciro stornosu (yanlış ciro geri alınır)
 *     description: >
 *       Ciro carisine ters ALACAK (CHEQUE_ENDORSE_CANCEL, reversesTxnId bağlı),
 *       durum ENDORSE öncesine (PORTFOLIO/AT_BANK) döner. Sebep ZORUNLU. Ciro bir
 *       teslim bordrosuyla yapıldıysa geri alma o bordronun kalemini geri alır (son
 *       kalemse bordro iptal olur); cevapta `data.deliveryNote`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek ENDORSED değil / yarış }
 */
router.post("/:id/endorse-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = reversalBody.parse(req.body ?? {});
    res.json(await chequeService.cancelEndorse(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/bounce-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Karşılıksız stornosu (yanlış karşılıksız kaydı geri alınır)
 *     description: >
 *       BOUNCE'un cari satır(lar)ı tersiyle kapanır (ciro edilmişse iki cari),
 *       durum BOUNCE öncesine döner. Sebep ZORUNLU.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek BOUNCED değil / yarış }
 */
router.post("/:id/bounce-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = reversalBody.parse(req.body ?? {});
    res.json(await chequeService.cancelBounce(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/return-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: İade stornosu (yanlış iade geri alınır)
 *     description: RETURN'ün cari satırı tersiyle kapanır, durum iade öncesine döner. Sebep ZORUNLU.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek RETURNED değil / yarış }
 */
router.post("/:id/return-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = reversalBody.parse(req.body ?? {});
    res.json(await chequeService.cancelReturn(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/pay-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Ödeme stornosu (yanlış ödeme geri alınır)
 *     description: >
 *       Para AYNI hesaba geri girer (PAY_CANCEL olayı), durum ISSUED'a döner;
 *       cari deftere dokunulmaz. Sebep ZORUNLU.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek PAID değil / yarış }
 */
router.post("/:id/pay-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = reversalBody.parse(req.body ?? {});
    res.json(await chequeService.cancelPay(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/deposit-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Bankaya verme stornosu (yanlış bankaya verilen çek tahsil edilmeden portföye döner)
 *     description: >
 *       Para OYNAMAZ (DEPOSIT de oynatmamıştı); DEPOSIT_CANCEL olayı hangi bankadan geri
 *       alındığını taşır, başlık bankası düşer, durum PORTFOLIO'ya döner. Sebep ZORUNLU.
 *       Tahsil edilmiş çekte 409 (önce tahsil stornosu). Bankaya verme bir teslim
 *       bordrosuyla yapıldıysa geri alma o bordronun kalemini geri alır (son kalemse
 *       bordro iptal olur); cevapta `data.deliveryNote`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek AT_BANK değil / yarış }
 */
router.post("/:id/deposit-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = reversalBody.parse(req.body ?? {});
    res.json(await chequeService.cancelDeposit(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
