// DENEME BİLDİRİMİ — hesap yalnız KENDİ etkin cihazlarına tek bir deneme gönderir (kuyruğa girmez, türü yoktur,
// bildirim geçmişine yazılmaz; ayak izi `account_audit`). Hız sınırı hesap başına dakikada bir (bellek içi,
// süreç başına — iş kararı değil, taşıyıcıyı korur). Ağ çağrısı tx DIŞINDA; kayıtsız cihaz pasife çekilir.
import { randomUUID } from "node:crypto";
import type { SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError, stateConflict } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import type { PushOutcome } from "../push/transports";
import type { TestNotificationResult } from "../wire/api";
import type { CloudContext } from "./context";

export const TEST_INTERVAL_MS = 60_000;
const lastSent = new WeakMap<CloudContext, Map<string, number>>();

function limiter(ctx: CloudContext): Map<string, number> {
  let m = lastSent.get(ctx);
  if (!m) lastSent.set(ctx, (m = new Map()));
  return m;
}

export async function sendTestNotification(ctx: CloudContext, s: SessionContext): Promise<TestNotificationResult> {
  const runtime = ctx.notifications ?? null;
  if (!runtime) throw stateConflict("Bildirim gönderimi bu sunucuda kapalı", { neden: "BILDIRIM_KAPALI" });
  const nowMs = ctx.now();
  const seen = limiter(ctx);
  const last = seen.get(s.accountId);
  if (last !== undefined && nowMs - last < TEST_INTERVAL_MS) {
    const waitSec = Math.ceil((last + TEST_INTERVAL_MS - nowMs) / 1000);
    throw new CloudError(429, "HIZ_SINIRI", `Deneme bildirimi dakikada bir gönderilebilir; ${waitSec} sn sonra tekrar deneyin`, { bekleSn: waitSec });
  }
  const devices = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.pushDevice.findMany({ where: { tesisId: s.tesisId, accountId: s.accountId, active: true }, select: { id: true, platform: true, token: true, name: true }, orderBy: { id: "asc" } }),
  );
  if (devices.length === 0) throw stateConflict("Bu hesaba kayıtlı etkin cihaz yok; önce bu cihazda bildirimleri açın", { neden: "CIHAZ_YOK" });
  if (seen.size > 10_000) for (const [k, v] of seen) if (nowMs - v >= TEST_INTERVAL_MS) seen.delete(k);
  seen.set(s.accountId, nowMs);
  const msg = { id: randomUUID(), title: "Deneme bildirimi", body: "Bildirimler bu cihaza ulaşıyor.", route: null };
  const results: { id: string; ad: string | null; platform: string; outcome: PushOutcome }[] = [];
  for (const d of devices) {
    let outcome: PushOutcome;
    try {
      outcome = await runtime.transport.send({ platform: d.platform, token: d.token }, msg);
    } catch {
      outcome = { kind: "GECICI", code: "TASIYICI_HATASI" };
    }
    results.push({ id: d.id, ad: d.name, platform: d.platform.toLowerCase(), outcome });
  }
  const invalid = results.filter((r) => r.outcome.kind === "GECERSIZ_CIHAZ").map((r) => r.id);
  if (invalid.length > 0) await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) => tx.pushDevice.updateMany({ where: { tesisId: s.tesisId, accountId: s.accountId, id: { in: invalid }, active: true }, data: { active: false } }));
  const sent = results.filter((r) => r.outcome.kind === "OK").length;
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "BILDIRIM_DENEME", entity: "Account", entityId: s.accountId, summary: { cihaz: results.length, basarili: sent, pasife: invalid.length } });
  return { gonderilen: sent, cihazlar: results.map((r) => ({ id: r.id, ad: r.ad, platform: r.platform, sonuc: r.outcome.kind })) };
}
