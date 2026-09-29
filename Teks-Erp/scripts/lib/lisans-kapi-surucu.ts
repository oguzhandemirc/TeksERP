// Lisans kapısı sürücüsü — `licenseGate`i sahte istek/yanıtla koşturur ve sonucu ölçer:
// `next` eşzamanlı mı çağrıldı (gözlemde sıfır fark), hata ne, yanıta dokunuldu mu.
// HTTP sunucusu açmaz; `test_` öneki yok → koşucu bunu bekçi saymaz.
import type { NextFunction, Request, Response } from "express";

export interface Uc {
  /** Büyük harf yöntem. */
  readonly m: string;
  /** Rota deseni (`/api/orders/:id`). */
  readonly desen: string;
  /** Desenden somut yol (`/api/orders/x1`). */
  readonly ornek: string;
}

export interface KapiSonucu {
  readonly esZamanli: boolean;
  readonly hata: unknown;
  readonly yanitaDokunuldu: boolean;
}

type Kapi = (req: Request, res: Response, next: NextFunction) => void;

function sahteYanit(dokun: () => void): Response {
  const kayit = (): Response => {
    dokun();
    return yanit;
  };
  const yanit = { status: kayit, json: kayit, send: kayit, set: kayit, setHeader: kayit, end: kayit } as unknown as Response;
  return yanit;
}

/** Kapıyı `/api` altına bağlıymış gibi koşturur (`baseUrl` + göreli `path`). */
export function kapidanGecir(kapi: Kapi, u: Uc, token: string | null): Promise<KapiSonucu> {
  const goreli = u.ornek.replace(/^\/api/, "") || "/";
  const req = {
    method: u.m,
    baseUrl: "/api",
    path: goreli,
    url: goreli,
    originalUrl: u.ornek,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
  let dokunuldu = false;
  const res = sahteYanit(() => {
    dokunuldu = true;
  });
  return new Promise((resolve) => {
    let dondu = false;
    const zamanAsimi = setTimeout(() => resolve({ esZamanli: false, hata: "ZAMAN_ASIMI", yanitaDokunuldu: dokunuldu }), 5000);
    kapi(req, res, (hata?: unknown) => {
      clearTimeout(zamanAsimi);
      resolve({ esZamanli: !dondu, hata, yanitaDokunuldu: dokunuldu });
    });
    dondu = true;
  });
}
