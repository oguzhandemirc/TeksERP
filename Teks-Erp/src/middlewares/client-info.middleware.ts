// =============================================================================
// TeksERP — İstemci künyesi toplayıcı (BİLGİLENDİRME, KAPI DEĞİL)
// =============================================================================
// `X-Client-*` başlıklarını okur ve süreç-içi deftere (`lib/client-registry`)
// işler. Tek tüketicisi Sistem → Bağlı İstemciler ekranıdır.
//
// ⚠️⚠️ FAIL-OPEN, HER ZAMAN. Bu middleware HİÇBİR isteği reddetmez, HİÇBİR
// yanıtı değiştirmez, HİÇBİR `req` alanı doldurmaz. Başlık yoksa / bozuksa /
// uydurulmuşsa istek hiç dokunulmadan geçer. Başlığın taşıdığı bilgi bir
// yetki/kapı kararına GİRMEZ — istemci onu tek satır curl ile uydurabilir
// (`constants/client-info.ts` başlığındaki `CLIENT_IP_HEADER` dersi).
//
// ⚠️ `req.user` BURADA HENÜZ YOKTUR — `verifyToken` aşağıda, route zincirinde
// koşar. Bu yüzden kayıt `res.on("finish")` anında alınır (emsal:
// `latency.middleware`). Tek çağrı noktası olması bilinçli: kimlikli ve
// kimliksiz istekleri iki ayrı yerden yazsaydık "son kullanıcı" alanının
// hangi yolun yazdığı okuyucuya kalırdı.
//
// KONUM: `latencyMiddleware`den hemen sonra, `resolveDevice`ten önce. Cihaz
// çözümüne bağımlı DEĞİL (kasten: masaüstü panelin `Device` satırı vardır ama
// `x-device-id` GÖNDERMEZ — bkz. constants/client-info.ts).
// =============================================================================

import { createHash } from "node:crypto";

import { Request, Response, NextFunction } from "express";

import { CLIENT_INFO_HEADERS } from "../constants/client-info";
import { shouldTouchClient, touchClient } from "../lib/client-registry";
import { parseLegacyClientFromUserAgent } from "../lib/legacy-client-ua";
import "../types/express-augment";

/** Tek değerli başlık okuma (dizi gelirse ilki). */
function readHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

/**
 * Künyesiz istek için YEDEK kimlik. Kurulum kimliği yoktur (istemci onu
 * göndermeyecek kadar eskidir), o yüzden elde ne varsa ondan türetilir:
 * kaynak IP + UA. Sabit olması yeter — aynı makine aynı satıra düşsün.
 *
 * ⚠️ IP SOKETTEN okunur, BAŞLIKTAN DEĞİL. `CLIENT_IP_HEADER` dersi
 * (`constants/client-info.ts`): uydurulabilir bir başlık deftere sınırsız
 * sahte satır açtırırdı.
 */
function legacyInstanceId(req: Request, userAgent: string): string {
  const ip = req.socket.remoteAddress ?? "?";
  const digest = createHash("sha1").update(`${ip}|${userAgent}`).digest("hex").slice(0, 24);
  return `legacy:${digest}`;
}

export function clientInfoMiddleware(req: Request, res: Response, next: NextFunction): void {
  // ① Künyesini bildirmeyen istemci (eski panel, curl, sağlık yoklaması) için
  //    maliyet: bir başlık okuması. Sessizce geçer — eski istemciler bozulmaz.
  const instanceId = readHeader(req, CLIENT_INFO_HEADERS.instance);
  if (!instanceId) return legacyFallback(req, res, next);

  // ② YAZMA KISITLAMASI (30 sn). Kapı burada, başlıkların GERİ KALANINI okumadan
  //    ve `finish` dinleyicisini KURMADAN önce — kısıtlamanın kazancı budur.
  if (!shouldTouchClient(instanceId)) return next();

  res.once("finish", () => {
    try {
      touchClient({
        instanceId,
        kind: readHeader(req, CLIENT_INFO_HEADERS.kind),
        version: readHeader(req, CLIENT_INFO_HEADERS.version),
        // `verifyToken` bu noktada koşmuştur; kimliksiz istekte undefined kalır
        // ve defterde "bilinmiyor" olarak yaşar (uydurulmaz).
        userId: req.user?.userId,
      });
    } catch {
      /* telemetri hiçbir koşulda isteği/yanıtı etkilemez */
    }
  });
  next();
}

/**
 * KÜNYESİZ İSTEK — sürümü UA'dan çıkarmayı dene (yalnız Electron paneli).
 *
 * `parseLegacyClientFromUserAgent` çıkaramazsa (tablet, tarayıcı, curl, sağlık
 * yoklaması) HİÇBİR ŞEY yapılmaz: defter uydurulmuş satırla şişmez. Fail-open
 * sözleşmesi burada da geçerli — bu fonksiyon isteği ASLA etkilemez.
 */
function legacyFallback(req: Request, res: Response, next: NextFunction): void {
  const userAgent = readHeader(req, "user-agent");
  const legacy = parseLegacyClientFromUserAgent(userAgent);
  if (!legacy || !userAgent) return next();

  const instanceId = legacyInstanceId(req, userAgent);
  if (!shouldTouchClient(instanceId)) return next();

  res.once("finish", () => {
    try {
      touchClient({
        instanceId,
        kind: legacy.kind,
        version: legacy.version,
        userId: req.user?.userId,
        // Beyan DEĞİL, ÇIKARIM — ekran ikisini ayırt etsin.
        declared: false,
      });
    } catch {
      /* telemetri hiçbir koşulda isteği/yanıtı etkilemez */
    }
  });
  next();
}
