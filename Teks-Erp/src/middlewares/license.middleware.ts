// =============================================================================
// LİSANS KAPISI (`licenseGate`) — app düzeyinde, `/api` altında, rotalardan ÖNCE
// =============================================================================
// Yöntem + yol ile sınıflar (`constants/license-routes.ts`). Kapalı yolda KİMLİK ÖNCE gelir:
// geçerli oturumu olmayan istek (başlık yok, imzası/süresi geçersiz, oturumu sonlanmış) kapıdan
// ROTAYA geçer ve rotanın `verifyToken`ı 401 döner; kademe yalnız geçerli oturuma uygulanır.
// Kimlik istemeyen uçlarda (`PUBLIC_ROUTES`) geçecek duvar olmadığından kapı yalnız genel
// `LICENSE_GATE` döner. Kimliksiz çağırana kademe/gün/modül SIZMAZ.
//
// Gözlem kipinde uygulanan kademe daima NORMAL'dir: kapı hiçbir isteği engellemez,
// yalnız "reddederdim" sayacını artırır (sıfır fark). Motor hazır değilse ya da durum
// hesaplanamıyorsa geçirir — lisans belirsizliği fabrikayı durdurmaz.
// G2 etkinleştirme kilidi kademeden ÖNCE gelir: hiç etkinleşmemiş kurulum yalnız etkinleştirme ekranını açar
// (`LICENSE_NOT_ACTIVATED`); etkin kurulumda kilit daima YOK, kademe kuralı aynen işler.
// 503 kullanılmaz (SERVER_BUSY'ye ayrılmış).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error";
import { getLicenseSnapshot, recordObservation, type LicenseSnapshot } from "../lib/license/runtime";
import type { LicenseState } from "../lib/license/state";
import { isOpenInTier, isOpenWhenActivationLocked, isPublicRoute, type ActivationLockRouteClass } from "../constants/license-routes";
import { AuthService } from "../services/auth.service";
import { verifyToken } from "./auth.middleware";

function readySnapshot(): LicenseSnapshot | null {
  try {
    const snap = getLicenseSnapshot();
    return snap.durumHazir ? snap : null;
  } catch {
    return null;
  }
}

/** Hafif denetim: Bearer başlığı + JWT imzası ve süresi (DB'siz). */
function hasPlausibleToken(req: Request): boolean {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return false;
  try {
    AuthService.verifyToken(token);
    return true;
  } catch {
    return false;
  }
}

/** İmzası geçerli token'ın oturumu da canlı mı (sonlanmış oturuma kademe ayrıntısı verilmez). */
function hasValidSession(req: Request, res: Response): Promise<boolean> {
  if (!hasPlausibleToken(req)) return Promise.resolve(false);
  return new Promise((resolve) => {
    void verifyToken(req, res, (err?: unknown) => resolve(!err));
  });
}

function tierRejection(state: LicenseState): AppError {
  if (state.uygulananKademe === "DURDURULMUS") {
    return AppError.forbidden(
      "Lisans durduruldu. Yalnız lisans ekranı ve 'verilerimi al' (yedek + dışa aktarma) açık.",
      { code: "LICENSE_SUSPENDED", kademe: state.uygulananKademe },
    );
  }
  const reason = state.devredildi
    ? "Üretim DR sunucusuna devredildi; bu sunucu kısıtlı kipte."
    : "Lisans kısıtlı kipte.";
  return AppError.forbidden(
    `${reason} Okuma, rapor, yeniden basım, yedek ve dışa aktarma açık; yeni kayıt kapalı.`,
    {
      code: "LICENSE_RESTRICTED",
      kademe: state.uygulananKademe,
      kisitlamaKalanGun: state.kisitlamaKalanGun,
      devredildi: state.devredildi,
    },
  );
}

function activationRejection(sinif: ActivationLockRouteClass): AppError {
  const text =
    sinif === "KOPYA"
      ? "Bu kurulumun lisans izi başka bir kuruluma ait. Lisans ekranından etkinleştirin ya da taşıma talebi açın; 'verilerimi al' (yedek + dışa aktarma) açık."
      : "Sunucu lisansı etkinleştirilmedi. Yalnız lisans etkinleştirme ekranı açık; yöneticinize başvurun.";
  return AppError.forbidden(text, { code: "LICENSE_NOT_ACTIVATED", sinif });
}

/** Kapalı yolda kimlik önce: oturumlu isteğe gerekçe, kimliksiz uçta genel ret, kalanı rotanın 401'ine. */
function rejectAfterIdentity(req: Request, res: Response, next: NextFunction, rejection: () => AppError): void {
  void hasValidSession(req, res).then((authenticated) => {
    if (authenticated) next(rejection());
    else if (isPublicRoute(req.method, `${req.baseUrl}${req.path}`)) next(publicRouteRejection());
    else next();
  });
}

function publicRouteRejection(): AppError {
  return AppError.forbidden("Bu işlem lisans durumu nedeniyle şu anda kullanılamıyor.", { code: "LICENSE_GATE" });
}

export function licenseGate(req: Request, res: Response, next: NextFunction): void {
  const snap = readySnapshot();
  if (!snap) {
    next();
    return;
  }
  const path = `${req.baseUrl}${req.path}`;
  const lock = snap.etkinlestirmeKilidi.sinif;
  if (lock !== "YOK") {
    if (isOpenWhenActivationLocked(lock, req.method, path)) next();
    else rejectAfterIdentity(req, res, next, () => activationRejection(lock));
    return;
  }
  const { uygulananKademe, hesaplananKademe } = snap.state;
  if (isOpenInTier(uygulananKademe, req.method, path)) {
    if (!isOpenInTier(hesaplananKademe, req.method, path)) recordObservation("istek");
    next();
    return;
  }
  rejectAfterIdentity(req, res, next, () => tierRejection(snap.state));
}
