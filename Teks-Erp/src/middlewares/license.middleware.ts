// =============================================================================
// LİSANS KAPISI (`licenseGate`) — app düzeyinde, `/api` altında, rotalardan ÖNCE
// =============================================================================
// Yöntem + yol ile sınıflar (`constants/license-routes.ts`), kimliğe BAKMAZ: lisans bir
// SUNUCU durumudur. Bu yüzden "önce 401" kuralının BEYANLI istisnasıdır — kimliksiz
// isteğe de 403 döner, ama yalnız genel `LICENSE_GATE` kodu; kademe ayrıntısı yalnız
// geçerli oturuma verilir (anonim çağırana K5 sinyali sızmaz).
//
// Gözlem kipinde uygulanan kademe daima NORMAL'dir: kapı hiçbir isteği engellemez,
// yalnız "reddederdim" sayacını artırır (sıfır fark). Motor hazır değilse ya da durum
// hesaplanamıyorsa geçirir — lisans belirsizliği fabrikayı durdurmaz.
// 503 kullanılmaz (SERVER_BUSY'ye ayrılmış).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error";
import { getLicenseSnapshot, recordObservation, type LicenseSnapshot } from "../lib/license/runtime";
import type { LicenseState } from "../lib/license/state";
import { isOpenInTier } from "../constants/license-routes";
import { verifyToken } from "./auth.middleware";

function readySnapshot(): LicenseSnapshot | null {
  try {
    const snap = getLicenseSnapshot();
    return snap.hazir ? snap : null;
  } catch {
    return null;
  }
}

/** Başlık varsa TAM doğrulama (oturum kaydı dahil); geçersiz/eksik = kimliksiz. */
function hasValidSession(req: Request, res: Response): Promise<boolean> {
  if (!req.headers.authorization) return Promise.resolve(false);
  return new Promise((resolve) => {
    void verifyToken(req, res, (err?: unknown) => resolve(!err));
  });
}

function rejection(state: LicenseState, authenticated: boolean): AppError {
  if (!authenticated) {
    return AppError.forbidden("Bu işlem lisans durumu nedeniyle şu anda kullanılamıyor.", { code: "LICENSE_GATE" });
  }
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

export function licenseGate(req: Request, res: Response, next: NextFunction): void {
  const snap = readySnapshot();
  if (!snap) {
    next();
    return;
  }
  const path = `${req.baseUrl}${req.path}`;
  const { uygulananKademe, hesaplananKademe } = snap.state;
  if (isOpenInTier(uygulananKademe, req.method, path)) {
    if (!isOpenInTier(hesaplananKademe, req.method, path)) recordObservation("istek");
    next();
    return;
  }
  void hasValidSession(req, res).then((authenticated) => next(rejection(snap.state, authenticated)));
}
