// =============================================================================
// TeksERP - Mobil güncelleme uçları (LAN İKİZİ)
// =============================================================================
// Sahadaki tabletler güncellemeyi İNTERNETTEN (VPS) alır — bkz.
// `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`. Buradaki uçlar aynı depoyu
// **internetsiz bir kurulum için** LAN üzerinden servis eder ve VPS'teki nginx
// ile BİREBİR AYNI yol düzenini kullanır:
//
//   GET /api/mobile/updates/ota/<runtimeVersion>/manifest   → donmuş manifest
//   GET /api/mobile/updates/<depo içindeki yol>             → paket dosyaları
//
// Böyle bir kurulumda paket şu adresle yayınlanır:
//   npm run yayinla -- --update-url=http://<sunucu>:4000/api/mobile/updates/
//
// ⚠️ SUNUCU MANİFEST ÜRETMEZ. Kod imzalama gövdenin HAM baytları üzerinden
// doğrulandığı için manifest yayın anında dondurulur; buradaki iş yalnız o
// baytları doğru başlıklarla servis etmektir.
//
// ⚠️ PUBLIC (JWT yok): tablet güncellemeyi giriş ekranından ÖNCE sorar. Kimlik
// aransaydı "açılmayan tablete düzeltme gönderme" yolu, yani kurtarmanın
// kendisi kapanırdı.
// =============================================================================

import { Router, Request, Response } from "express";
import fs from "fs";

import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { MULTIPART_BOUNDARY } from "../config/mobile-update";
import { depoDurumu, dosyaBilgi, manifestGorelYolu } from "../services/mobile-update.service";

const router = Router();

/**
 * @openapi
 * /api/mobile/updates/ota/{runtimeVersion}/manifest:
 *   get:
 *     tags: [Mobil]
 *     summary: Donmuş güncelleme manifesti (Expo Updates protokolü v1 — PUBLIC)
 *     responses:
 *       200: { description: multipart/mixed manifest }
 *       404: { description: Bu sürüm için yayın yok }
 */
router.get("/updates/ota/:runtimeVersion/manifest", async (req: Request, res: Response) => {
  const bilgi = await dosyaBilgi(manifestGorelYolu(String(req.params.runtimeVersion)));

  // ⚠️ Bu üç başlık YAPILANDIRMA DEĞİL SÖZLEŞMEDİR:
  // `expo-protocol-version` yoksa istemci "Legacy manifests are no longer
  // supported" ile düşer (`manifest/UpdateFactory.kt:18-20`); sınırlayıcı
  // yanlışsa MIME ayrıştırıcısı gövdeyi hiç göremez ve durum "hata" değil
  // "güncelleme yok" olarak görünür. VPS tarafında aynı başlıkları nginx basar.
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("cache-control", "no-cache, must-revalidate");
  res.setHeader("content-type", `multipart/mixed; boundary=${MULTIPART_BOUNDARY}`);
  res.status(200).send(fs.readFileSync(bilgi.yol));
});

/**
 * @openapi
 * /api/mobile/updates/{yol}:
 *   get:
 *     tags: [Mobil]
 *     summary: Güncelleme deposundaki bir dosya (PUBLIC)
 *     description: Paket varlıkları, `manifest-<damga>` kopyaları, `apk/surum.json`, APK.
 *     responses:
 *       200: { description: Dosya içeriği }
 */
router.get("/updates/{*yol}", async (req: Request, res: Response) => {
  const parcalar = req.params.yol;
  const gorel = Array.isArray(parcalar) ? parcalar.join("/") : String(parcalar ?? "");
  const bilgi = await dosyaBilgi(gorel);

  // Varlık yolları damgayı taşır → içerik DEĞİŞMEZ, uzun önbellek güvenli.
  // Künye (`surum.json`) ve manifest kopyaları değişebilir → taze okunur.
  const degisebilir = /(?:^|\/)(surum\.json|manifest(?:-\d+)?)$/.test(gorel);
  res.setHeader(
    "cache-control",
    degisebilir ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
  );
  res.type(bilgi.contentType);
  res.sendFile(bilgi.yol);
});

/**
 * @openapi
 * /api/mobile/updates-state:
 *   get:
 *     tags: [Mobil]
 *     summary: "Mobil güncelleme deposu durumu (yetki: admin:settings)"
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/updates-state",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: await depoDurumu() });
  },
);

export default router;
