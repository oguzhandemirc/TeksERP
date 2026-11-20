// GÖRÜNÜM TERCİHLERİ (D7) — hesabın liste sıralaması / görünen sütunları; KULLANICI TERCİHİ: iş kararı okumaz, defter
// değildir. Hesap yalnız KENDİ satırını okur/yazar (anahtar oturumdan; başka hesabın kimliği parametre değil).
// Anahtar beyaz listeli (`VIEW_PREF_KEYS`), değer JSON nesnesi ve `VIEW_PREF_MAX_BYTES` sınırlı; tanınmayan anahtar 404.
import type { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import { VIEW_PREF_KEYS, VIEW_PREF_MAX_BYTES, type ViewPrefKey, type ViewPreference } from "../wire/api";
import type { CloudContext } from "./context";

export function viewPrefKey(raw: string): ViewPrefKey {
  if (!(VIEW_PREF_KEYS as readonly string[]).includes(raw)) throw notFound("Tercih");
  return raw as ViewPrefKey;
}

/** Değer kapısı: JSON nesnesi, metni en çok `VIEW_PREF_MAX_BYTES` bayt (sessiz kırpma yok). */
export function checkViewPrefValue(value: unknown): Prisma.InputJsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("Tercih bir nesne olmalı");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > VIEW_PREF_MAX_BYTES) throw badRequest(`Tercih en çok ${VIEW_PREF_MAX_BYTES} bayt`);
  return value as Prisma.InputJsonValue;
}

const where = (s: SessionContext, key: ViewPrefKey) => ({ tesisId_accountId_key: { tesisId: s.tesisId, accountId: s.accountId, key } });

export async function getViewPreference(ctx: CloudContext, s: SessionContext, key: ViewPrefKey): Promise<ViewPreference> {
  const row = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) => tx.viewPreference.findUnique({ where: where(s, key) }));
  return { anahtar: key, deger: row?.value ?? null, guncelleme: row?.updatedAt.toISOString() ?? null };
}

/** Tam yerine koyma: tekrarı aynı sonuç. Satır silinmez ("varsayılana dön" = istemci varsayılanı yazar). */
export async function setViewPreference(ctx: CloudContext, s: SessionContext, key: ViewPrefKey, value: unknown): Promise<ViewPreference> {
  const json = checkViewPrefValue(value);
  const row = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.viewPreference.upsert({ where: where(s, key), create: { tesisId: s.tesisId, accountId: s.accountId, key, value: json }, update: { value: json } }),
  );
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "GORUNUM_TERCIHI", entity: "ViewPreference", entityId: s.accountId, summary: { anahtar: key } });
  return { anahtar: key, deger: row.value, guncelleme: row.updatedAt.toISOString() };
}
