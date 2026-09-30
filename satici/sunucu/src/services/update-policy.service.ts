// GÜNCELLEME POLİTİKASI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §2): kurulum başına kip · pencere · sabitleme.
// Kiraya `guncelleme` alanı olarak ALT imzayla basılır; pencere kuralı fabrikanın bildirdiği saat dilimiyle
// (`kurulum.saatDilimi`, yoksa fabrika varsayılanı) kiranın ömrü boyunca MUTLAK aralıklara çevrilir — güncelleyici
// dilim hesabı yapmaz. Politika değişimi `kurulum_kaydi`na satır + `guncelleme` zili; yoklamanın güncelleme
// raporu kurulumun durum kolonlarına, tamamlanan denemenin sonucu deftere (`kayitId` ile idempotent).
import type { Kurulum, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  LeaseUpdatePolicySchema,
  ReleaseVersionSchema,
  UPDATE_MODES,
  UpdateWindowRuleSchema,
  isKnownTimeZone,
  windowIntervals,
  type LeaseUpdatePolicy,
  type UpdateReport,
} from "../lisans-protokol";
import { VendorError, notFoundError } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import type { Db, Tx } from "../lib/prisma";
import { notifyDoorbell } from "./doorbell";
import { requireReason } from "./sanction.service";

/** Fabrikanın dilimi hiç bildirmediği kurulumda pencerenin yorumlandığı dilim — backend `DEFAULT_FACTORY_TIMEZONE` ile aynı. */
export const FACTORY_DEFAULT_TIME_ZONE = "Europe/Istanbul";

/** Tamamlanan güncelleme denemesinin defter olayı (sonuç → `kurulum_kaydi.olay`). */
export const UPDATE_RESULT_EVENTS = {
  BASARILI: "GUNCELLEME_BASARILI",
  GERI_DONDU: "GUNCELLEME_GERI_DONDU",
  BASARISIZ: "GUNCELLEME_BASARISIZ",
} as const;
export const UPDATE_POLICY_EVENT = "GUNCELLEME_POLITIKASI";

/** Portal girdisi: pencere dilimsiz (dilim fabrikadan gelir). Kural protokolün pencere şemasıyla doğrulanır. */
export const UpdatePolicyInputSchema = z.strictObject({
  kip: z.enum(UPDATE_MODES),
  pencere: z.strictObject({ baslangic: z.string(), bitis: z.string(), gunler: z.array(z.number().int()) }).nullable(),
  hedefSurum: ReleaseVersionSchema.nullable(),
});
export type UpdatePolicyInput = z.infer<typeof UpdatePolicyInputSchema>;

type PolicyColumns = Pick<
  Kurulum,
  "guncellemeKipi" | "guncellemePencereBaslangic" | "guncellemePencereBitis" | "guncellemePencereGunleri" | "guncellemeHedefSurum" | "saatDilimi"
>;

/** Kurulum kolonlarından politika (dilimsiz). */
export function policyOf(inst: PolicyColumns): UpdatePolicyInput {
  const window = inst.guncellemePencereBaslangic && inst.guncellemePencereBitis
    ? { baslangic: inst.guncellemePencereBaslangic, bitis: inst.guncellemePencereBitis, gunler: [...inst.guncellemePencereGunleri] }
    : null;
  return { kip: inst.guncellemeKipi, pencere: window, hedefSurum: inst.guncellemeHedefSurum };
}

/** Pencerenin yorumlanacağı dilim: fabrikanın bildirdiği (tanınıyorsa), yoksa fabrika varsayılanı. */
export function policyTimeZone(inst: Pick<Kurulum, "saatDilimi">): string {
  return inst.saatDilimi && isKnownTimeZone(inst.saatDilimi) ? inst.saatDilimi : FACTORY_DEFAULT_TIME_ZONE;
}

/** Portal girdisini protokol kuralıyla doğrular (400 `GOVDE_GECERSIZ`); gün listesi sıralanıp tekilleşir. */
export function validatePolicy(input: UpdatePolicyInput, timeZone: string): UpdatePolicyInput {
  const window = input.pencere ? { ...input.pencere, gunler: [...new Set(input.pencere.gunler)].sort((a, b) => a - b) } : null;
  const p = LeaseUpdatePolicySchema.safeParse({
    kip: input.kip,
    pencere: window ? { ...window, saatDilimi: timeZone } : null,
    araliklar: [],
    hedefSurum: input.hedefSurum,
  });
  if (!p.success) throw new VendorError(400, "GOVDE_GECERSIZ", `Güncelleme politikası geçersiz: ${p.error.issues[0]?.message ?? "şema"}`);
  if (window && !UpdateWindowRuleSchema.safeParse({ ...window, saatDilimi: timeZone }).success) {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Güncelleme penceresi geçersiz");
  }
  return { kip: input.kip, pencere: window, hedefSurum: input.hedefSurum };
}

/** Kiranın `guncelleme` alanı — kuralın `[fromMs, toMs)` (kiranın ömrü) ile kesişen mutlak aralıklarıyla. */
export function leaseUpdatePolicy(inst: PolicyColumns, fromMs: number, toMs: number): LeaseUpdatePolicy {
  const p = policyOf(inst);
  if (!p.pencere) return { kip: p.kip, pencere: null, araliklar: [], hedefSurum: p.hedefSurum };
  const rule = { ...p.pencere, saatDilimi: policyTimeZone(inst) };
  return LeaseUpdatePolicySchema.parse({ kip: p.kip, pencere: rule, araliklar: windowIntervals(rule, fromMs, toMs), hedefSurum: p.hedefSurum });
}

const samePolicy = (a: UpdatePolicyInput, b: UpdatePolicyInput): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Politikayı değiştirir: kurulum kilidi altında; değişim deftere yazılır ve `guncelleme` zili çalar. Aynı politika no-op. */
export async function setUpdatePolicyTx(
  tx: Tx,
  g: { installationDbId: string; policy: UpdatePolicyInput; reason: string; actor: string },
): Promise<{ kurulum: Kurulum; politika: UpdatePolicyInput; degisti: boolean }> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason, "Güncelleme politikasını değiştirmek");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  const next = validatePolicy(g.policy, policyTimeZone(inst));
  const previous = policyOf(inst);
  if (samePolicy(previous, next)) return { kurulum: inst, politika: previous, degisti: false };
  const kurulum = await tx.kurulum.update({
    where: { id: inst.id },
    data: {
      guncellemeKipi: next.kip,
      guncellemePencereBaslangic: next.pencere?.baslangic ?? null,
      guncellemePencereBitis: next.pencere?.bitis ?? null,
      guncellemePencereGunleri: next.pencere?.gunler ?? [],
      guncellemeHedefSurum: next.hedefSurum,
    },
  });
  const ayrinti: Prisma.InputJsonObject = { onceki: previous, yeni: next, sebep: reason };
  await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay: UPDATE_POLICY_EVENT, ayrinti, yapan: g.actor } });
  await notifyDoorbell(tx, inst.id, "guncelleme");
  return { kurulum, politika: next, degisti: true };
}

/**
 * Yoklamanın güncelleme raporu (kira verildikten SONRA, ayrı ve idempotent): dilim + güncelleyici durumu + bekleyen
 * karar kurulumun DURUM kolonlarına; tamamlanan deneme `kurulum_kaydi` DEFTERİNE `(kurulum, kayitId)` ile bir kez.
 */
export async function recordUpdateReport(
  db: Db,
  g: { installationDbId: string; kid: string; report: UpdateReport | undefined; nowMs: number },
): Promise<void> {
  if (!g.report) return;
  const r = g.report;
  const summary: Prisma.InputJsonObject = { guncelleyici: r.guncelleyici, bekleyen: r.bekleyen, son: r.son };
  await db.kurulum.update({
    where: { id: g.installationDbId },
    data: { saatDilimi: r.saatDilimi, sonGuncellemeRaporu: summary, sonGuncellemeRaporuZamani: new Date(g.nowMs) },
  });
  if (!r.son) return;
  await db.kurulumKaydi.createMany({
    data: [{
      kurulumId: g.installationDbId,
      olay: UPDATE_RESULT_EVENTS[r.son.sonuc],
      anahtarKimligi: g.kid,
      ayrinti: r.son as unknown as Prisma.InputJsonObject,
      yapan: "guncelleyici",
      kaynakKayitId: r.son.kayitId,
    }],
    skipDuplicates: true,
  });
}
