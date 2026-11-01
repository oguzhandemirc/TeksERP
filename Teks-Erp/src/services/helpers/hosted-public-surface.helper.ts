// Barındırılan (internete açık) kurulumda kimliksiz yüzeyin daraltılması (VDS denetimi D1).
// LAN kurulumu bayt-aynıdır. Onaylı cihaz (kanıtlı `req.device`) tam yanıtı alır: tablet giriş
// ekranı firma adını ve K5/G2 lisans sinyalini bugünkü gibi gösterir; masaüstü/tarayıcı lisans
// durumunu girişten sonra `GET /api/license/durum`dan okur.
import { DEFAULT_COMPANY_NAME } from "../../constants/company";

export interface LoginMethodsPublic {
  companyName: string;
  lisansDurduruldu?: boolean;
  lisansEtkinlesmedi?: boolean;
}

export function redactLoginMethods<T extends LoginMethodsPublic>(
  data: T,
  opts: { hosted: boolean; approvedDevice: boolean },
): T | Omit<T, "lisansDurduruldu" | "lisansEtkinlesmedi"> {
  if (!opts.hosted || opts.approvedDevice) return data;
  const { lisansDurduruldu: _s, lisansEtkinlesmedi: _e, ...rest } = data;
  return { ...rest, companyName: DEFAULT_COMPANY_NAME };
}
