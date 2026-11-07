// =============================================================================
// Erişim günlüğü (morgan) jetonları + üretim biçimi — sahada yavaş isteğin nedenini greplenebilir kılar
// =============================================================================
// Üretim satırı = combined + ` <ms>ms rid=<reqId> uid=<userId|-> code=<details.code|->`. Sır taşımaz:
// `url`/`referrer` sır parametrelerini maskeler; `remote-user` Authorization başlığını OKUMAZ (hep `-`).
// =============================================================================

import type { Request, Response } from "express";
import type morgan from "morgan";
import { redactSecretQueryParams } from "../utils/url-redaction";

/** morgan `combined` gövdesi + teşhis kuyruğu. `remote-user` jetonu aşağıda `-`ye sabitlenir. */
export const PROD_ACCESS_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ' +
  '":referrer" ":user-agent" :response-time[0]ms rid=:rid uid=:uid code=:code';

export function registerAccessLogTokens(m: typeof morgan): void {
  m.token<Request, Response>("url", (req) => redactSecretQueryParams(req.originalUrl || req.url || ""));
  m.token<Request, Response>("referrer", (req) => {
    const ref = req.headers.referer ?? req.headers.referrer;
    return ref ? redactSecretQueryParams(String(ref)) : undefined;
  });
  // morgan'ın varsayılanı Basic Authorization'ı çözer — Authorization başlığı hiçbir biçimde loga girmez.
  m.token<Request, Response>("remote-user", () => undefined);
  m.token<Request, Response>("rid", (req) => req.reqId);
  // Satır yanıt bitince yazılır: verifyToken'ın doldurduğu kullanıcı burada okunabilir.
  m.token<Request, Response>("uid", (req) => req.user?.userId);
  m.token<Request, Response>("code", (_req, res) => (res.statusCode >= 400 ? res.locals.errorCode : undefined));
}
