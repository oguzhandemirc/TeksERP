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

import { Request, Response, NextFunction } from "express";

import { CLIENT_INFO_HEADERS } from "../constants/client-info";
import { shouldTouchClient, touchClient } from "../lib/client-registry";
import "../types/express-augment";

/** Tek değerli başlık okuma (dizi gelirse ilki). */
function readHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export function clientInfoMiddleware(req: Request, res: Response, next: NextFunction): void {
  // ① Künyesini bildirmeyen istemci (eski panel, curl, sağlık yoklaması) için
  //    maliyet: bir başlık okuması. Sessizce geçer — eski istemciler bozulmaz.
  const instanceId = readHeader(req, CLIENT_INFO_HEADERS.instance);
  if (!instanceId) return next();

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
