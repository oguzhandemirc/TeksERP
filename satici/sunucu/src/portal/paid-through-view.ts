// PORTAL: ödenmiş tarih görünümü (lisans v2) — kurulum künyesinin `odenmisTarih` bloğu. Değerler tek kaynaktan
// (`services/paid-through.ts`); fabrikanın kararını satıcı yalnız TAHMİN eder (dosyayla yüklenen kirayı bilmez).
import type { Db } from "../lib/prisma";
import { entitlementTokenFor } from "../services/lease.service";
import { ONLINE_WINDOW_MS, lastExchangeAt, paidThroughModelActive, paidThroughOf, reminderBandVisible } from "../services/paid-through";

/**
 * Ödenmiş tarih görünümü (lisans v2): P ve kaynağı (`paid-through.ts` tek kaynak), fabrikanın P modelini işletip
 * işletmediği (yetenek + HAK ufku + kira alanı), son başarılı alışveriş ve bilgi bandının TAHMİNİ (karar fabrikada).
 */
export async function paidThroughView(db: Db, installationDbId: string, nowMs: number) {
  const inst = await db.kurulum.findUnique({ where: { id: installationDbId }, select: { id: true, anahtarKimligi: true, sonKiraId: true, yetenekler: true } });
  const hak = inst ? await db.hak.findFirst({ where: { kurulumId: inst.id, aktif: true } }) : null;
  if (!inst || !hak) return null;
  const paid = await paidThroughOf(db, inst.id, hak);
  const lastExchange = await lastExchangeAt(db, inst);
  const tip = inst.sonKiraId ? await db.kira.findUnique({ where: { id: inst.sonKiraId }, select: { belge: true } }) : null;
  const entitlementToken = hak.guncelSurum >= 1 ? await entitlementTokenFor(db, inst, hak) : null;
  return {
    tarih: paid.tarih,
    tur: paid.tur,
    pModeli: paidThroughModelActive({ capabilities: inst.yetenekler, entitlementToken, leaseToken: tip?.belge ?? null }),
    sonAlisveris: lastExchange,
    internetVar: lastExchange !== null && nowMs - lastExchange.getTime() < ONLINE_WINDOW_MS,
    bantGorunurTahmini: reminderBandVisible(paid, lastExchange?.getTime() ?? null, nowMs),
  };
}
