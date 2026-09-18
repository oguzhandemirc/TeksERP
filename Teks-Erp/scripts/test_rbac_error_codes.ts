// =============================================================================
// BEKÇİ — 403 YETKİ REDDİ `details.code` TAŞIR (PERMISSION_DENIED · CHANNEL_DENIED), 2026-09-18
// =============================================================================
//   §1 `requirePermission` reddi: 403 + `details.code === "PERMISSION_DENIED"` + `details.required` izin kodu;
//      izin varsa / wildcard (`x:*`, `*`) geçer; kimliksiz istek 401 (kod yok — yetki değil kimlik)
//   §2 `requireAnyPermission` reddi: aynı kod + `details.requiredAny` (dizi, sıra korunur); biri varsa geçer
//   §3 STATİK: kanal reddi (`auth.service` mobil-only hesap → masaüstü) AYRI kod `CHANNEL_DENIED` + `channel`;
//      izin reddiyle aynı koda BAĞLANMAZ; hata gövdesi `details`i geçirir (`error.middleware`); swagger
//      `ForbiddenError` şeması iki kodu da sayar; `body.code` YAZILMAZ (kural: `details.code`)
//   §4 Metin DEĞİŞMEDİ: koda bakmayan istemci aynı cümleyi görür ("yetkisi gerekli." / "yetkilerden birine")
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18): ① `requirePermission`den `details` düşürülünce §1b/§1c/§3b ❌ ·
//    ② `auth.service` kanal reddinden `code: "CHANNEL_DENIED"` silinince §3a ❌.
// DB'siz, saf (mandal sınıfı) — middleware sahte req/next ile çağrılır.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { RBAC_DENIED_CODE, requireAnyPermission, requirePermission } from "../src/middlewares/rbac.middleware";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const ROOT = path.resolve(__dirname, "..");

type Sonuc = { err: AppError | null; gecti: boolean };
function kos(mw: (req: Request, res: Response, next: (e?: unknown) => void) => void, permissions: readonly string[] | null): Sonuc {
  const req = (permissions ? { user: { userId: "u", username: "u", permissions: [...permissions] } } : {}) as unknown as Request;
  let err: AppError | null = null;
  let gecti = false;
  mw(req, {} as Response, (e?: unknown) => {
    if (e instanceof AppError) err = e;
    else if (e === undefined) gecti = true;
    else throw e;
  });
  return { err, gecti };
}
const ayrinti = (e: AppError | null): Record<string, unknown> => (e?.details as Record<string, unknown> | undefined) ?? {};

function main(): void {
  console.log("=== 403 YETKİ REDDİ KODLARI BEKÇİSİ ===\n");

  console.log("── §1 requirePermission ──");
  const r1 = kos(requirePermission("order:write"), ["order:read"]);
  check("§1a izin yok → 403 (AppError.forbidden)", r1.err?.statusCode === 403 && !r1.gecti);
  check("§1b ⭐ details.code === PERMISSION_DENIED", ayrinti(r1.err).code === "PERMISSION_DENIED" && RBAC_DENIED_CODE === "PERMISSION_DENIED", JSON.stringify(ayrinti(r1.err)));
  check("§1c ⭐ details.required gereken izin kodu", ayrinti(r1.err).required === "order:write");
  check("§1d izin varsa geçer · domain wildcard geçer · `*` geçer", kos(requirePermission("order:write"), ["order:write"]).gecti && kos(requirePermission("order:write"), ["order:*"]).gecti && kos(requirePermission("order:write"), ["*"]).gecti);
  const r1e = kos(requirePermission("order:write"), null);
  check("§1e kimliksiz → 401, kod yok (kimlik ≠ yetki)", r1e.err?.statusCode === 401 && ayrinti(r1e.err).code === undefined);

  console.log("\n── §2 requireAnyPermission ──");
  const r2 = kos(requireAnyPermission("shipping:invoice", "finance:write"), ["order:read"]);
  check("§2a hiçbiri yok → 403 PERMISSION_DENIED + requiredAny [shipping:invoice, finance:write]", r2.err?.statusCode === 403 && ayrinti(r2.err).code === "PERMISSION_DENIED" && JSON.stringify(ayrinti(r2.err).requiredAny) === JSON.stringify(["shipping:invoice", "finance:write"]), JSON.stringify(ayrinti(r2.err)));
  check("§2b biri varsa geçer", kos(requireAnyPermission("shipping:invoice", "finance:write"), ["finance:write"]).gecti);
  check("§2c tekil `required` alanı requiredAny reddinde YOK (iki şekil karışmaz)", ayrinti(r2.err).required === undefined);

  console.log("\n── §3 Statik ──");
  const auth = readFileSync(path.join(ROOT, "src/services/auth.service.ts"), "utf8");
  const kanal = auth.slice(auth.indexOf("masaüstü paneline erişimi yok"), auth.indexOf("masaüstü paneline erişimi yok") + 200);
  check("§3a ⭐ kanal reddi AYRI kod: CHANNEL_DENIED + channel: desktop (PERMISSION_DENIED DEĞİL)", /code: "CHANNEL_DENIED"/.test(kanal) && /channel: "desktop"/.test(kanal) && !/PERMISSION_DENIED/.test(kanal));
  const rbac = readFileSync(path.join(ROOT, "src/middlewares/rbac.middleware.ts"), "utf8");
  check("§3b rbac middleware kodu YALNIZ details nesnesine koyar (iki red yolu da), gövdeye `.code =` yazmaz", !/\.code\s*=[^=]/.test(rbac) && (rbac.match(/code: RBAC_DENIED_CODE/g) ?? []).length === 2);
  const errMw = readFileSync(path.join(ROOT, "src/middlewares/error.middleware.ts"), "utf8");
  check("§3c hata gövdesi `details`i geçirir (kod istemciye ulaşır)", /details: err\.details/.test(errMw));
  const swagger = readFileSync(path.join(ROOT, "src/config/swagger.ts"), "utf8");
  check("§3d swagger `ForbiddenError` şeması iki kodu da sayar", /ForbiddenError/.test(swagger) && /'PERMISSION_DENIED'/.test(swagger) && /'CHANNEL_DENIED'/.test(swagger));

  console.log("\n── §4 Metin değişmedi ──");
  check("§4a tekil red cümlesi aynen: \"Bu işlem için 'x' yetkisi gerekli.\"", r1.err?.message === "Bu işlem için 'order:write' yetkisi gerekli.");
  check("§4b çoklu red cümlesi aynen: \"… şu yetkilerden birine ihtiyacınız var: a, b\"", r2.err?.message === "Bu işlem için şu yetkilerden birine ihtiyacınız var: shipping:invoice, finance:write");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
