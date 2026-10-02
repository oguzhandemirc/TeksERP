// YEREL MÜDAHALE ŞÜPHESİ + YABANCI HAK (lisans v2 §3.1-5, §2.2-3) — yalnız UYARI: kira yine verilir, hiçbir neden
// tek başına süre kısaltmaz (fabrika aniden durmaz). Nedenler yoklamanın imzalı gövdesinden türer:
//   SIRA_GERILEDI / SIRA_SIFIRLANDI — imzalı durum kaydının sırası satıcının son gördüğünden küçük / kayıt yok ya da
//   sıra 0'dan yeniden başlamış (K7: üç iz silinince fabrika kirasız kaydı sıra 0'la doğurur ve hemen ek süreye geçer,
//   satıcıda görünen yüzü budur) · LISANS_IZI_KAYIP — fabrika bulgusu (tek
//   iz kaybı da: kira, durum kaydı ya da DB izinden biri) ·
//   BELIRSIZLIK — süren ölçülemedi birikimi 7 günü aştı · SAAT_SAPMASI — fabrikanın ölçtüğü satıcı sapması büyük ·
//   YETENEK_DUSUSU — `hak-ara` bildirmeyen yoklamaya genişlik kapısı tuttu (eski kök sürüm güncelden geniş; meşru olabilir:
//   eski derlemeye geri dönüş — yalnız bilgi, kök imzası kuyruğa girer).
// YABANCI_HAK kendi uyarısıdır (YABANCI_KIRA emsali): sunulan HAK satıcının defterinde yok ya da bayt özeti tutmuyor.
// Uyarı × YENİ neden başına bir bildirim (`YEREL_MUDAHALE_SUPHESI`); süren nedenin tekrarı bildirim doğurmaz.
import type { KopyaUyarisi, Kurulum, Prisma } from "@prisma/client";
import { DAY_MS, jwsDigest, type Fingerprint, type PollRequest } from "../lisans-protokol";
import type { Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";

export const LOCAL_INTERVENTION_CAUSES = ["SIRA_GERILEDI", "SIRA_SIFIRLANDI", "LISANS_IZI_KAYIP", "BELIRSIZLIK", "SAAT_SAPMASI", "YETENEK_DUSUSU"] as const;
export type LocalInterventionCause = (typeof LOCAL_INTERVENTION_CAUSES)[number];

/** Bildirim referansı ve portal etiketi (sunucu tek kaynak; web aynası `mirrors.test.ts`). */
export const LOCAL_INTERVENTION_CAUSE_LABELS: Readonly<Record<LocalInterventionCause, string>> = {
  SIRA_GERILEDI: "Durum kaydı sırası geriledi (eski kopya geri yüklenmiş)",
  SIRA_SIFIRLANDI: "Durum kaydı sıfırlandı (lisans izleri silinmiş)",
  LISANS_IZI_KAYIP: "Lisans izi kayıp (kira, durum kaydı ya da DB izinden en az biri yok)",
  BELIRSIZLIK: "Süren ölçülemedi 7 günü aştı",
  SAAT_SAPMASI: "Fabrika saati satıcıdan çok sapmış",
  YETENEK_DUSUSU: "Yetenek düşüşü: eski kök sürüm güncelden geniş, HAK teslim edilmedi (kök imzası kuyrukta)",
};

/** Belirsizlik birikimi bu süreyi aşınca neden doğar (§3.1-5). */
export const UNCERTAINTY_ALERT_MS = 7 * DAY_MS;
/** Fabrikanın ölçtüğü |duvar − satıcı| bu kadar saniyeyi aşınca neden doğar (istek penceresi ±10 dk; 1 sa bilinçli pay). */
export const CLOCK_SKEW_ALERT_SECONDS = 3600;
/** Kolonun (INT4) taşıyabildiği en büyük sıra: sığmayan bildirim saklanmaz ve karşılaştırılmaz (sayaç buna erişmez). */
export const MAX_STORED_SEQUENCE = 2_147_483_647;

/** Saklanacak sıra: `undefined` = bildirim yok ya da sığmıyor (kolon değişmez) · `null` = kayıt yok. */
export function storableSequence(record: PollRequest["durumKaydi"]): number | null | undefined {
  if (!record) return undefined;
  if (record.sira === null) return null;
  return record.sira <= MAX_STORED_SEQUENCE ? record.sira : undefined;
}

/** Fabrikanın durum özetindeki bulgu kodu (G12 §3.1-4). */
export const TRACE_LOST_FINDING = "LISANS_IZI_KAYIP";

/** Yoklamanın lisans v2 ekleri (yalnız doluysa gelir; eski fabrika hiçbirini göndermez). */
export interface PollV2Report {
  readonly capabilities: readonly string[];
  readonly stateRecord: PollRequest["durumKaydi"];
  readonly uncertainty: PollRequest["belirsizlik"];
  readonly lostFactors: PollRequest["parmakIziKayip"];
}

export function pollV2Report(body: Pick<PollRequest, "yetenekler" | "durumKaydi" | "belirsizlik" | "parmakIziKayip">): PollV2Report {
  return { capabilities: body.yetenekler ?? [], stateRecord: body.durumKaydi, uncertainty: body.belirsizlik, lostFactors: body.parmakIziKayip };
}

/** SAF: bu yoklamanın nedenleri. Sıra karşılaştırması satıcının SON gördüğü sıraya göre (null = henüz görülmedi). */
export function localInterventionCauses(g: {
  readonly lastSeenSequence: number | null;
  readonly report: PollV2Report;
  readonly findings: readonly string[];
  readonly vendorSkewSeconds: number | undefined;
  /** Genişlik kapısı bu yoklamada tuttu (`deliverableEntitlement` → `withheld`). */
  readonly capabilityDowngrade?: boolean;
}): LocalInterventionCause[] {
  const out: LocalInterventionCause[] = [];
  const sequence = storableSequence(g.report.stateRecord);
  if (sequence !== undefined && g.lastSeenSequence !== null) {
    // K7'de fabrika KİRASIZ kaydı sıra 0'dan başlatır: satıcı sıra görmüşken gelen 0 eski kopya değil, sıfırlanmadır.
    if (sequence === null || (sequence === 0 && g.lastSeenSequence > 0)) out.push("SIRA_SIFIRLANDI");
    else if (sequence < g.lastSeenSequence) out.push("SIRA_GERILEDI");
  }
  if (g.findings.includes(TRACE_LOST_FINDING)) out.push("LISANS_IZI_KAYIP");
  if (g.report.uncertainty && g.report.uncertainty.birikenMs > UNCERTAINTY_ALERT_MS) out.push("BELIRSIZLIK");
  if (g.vendorSkewSeconds !== undefined && Math.abs(g.vendorSkewSeconds) >= CLOCK_SKEW_ALERT_SECONDS) out.push("SAAT_SAPMASI");
  if (g.capabilityDowngrade) out.push("YETENEK_DUSUSU");
  return out;
}

/** Uyarının ayrıntısı: görülen nedenler (ilk görülme sırasıyla) ve neden başına görülme sayısı + son ölçümler. */
interface InterventionDetail {
  nedenler: LocalInterventionCause[];
  sayac: Partial<Record<LocalInterventionCause, number>>;
  sonSira?: number | null;
  oncekiSira?: number | null;
  belirsizlikMs?: number;
  sapmaSn?: number;
}

function readDetail(value: unknown): InterventionDetail {
  const v = (value ?? {}) as Partial<InterventionDetail>;
  const known = (x: unknown): x is LocalInterventionCause => (LOCAL_INTERVENTION_CAUSES as readonly string[]).includes(x as string);
  return { nedenler: Array.isArray(v.nedenler) ? v.nedenler.filter(known) : [], sayac: typeof v.sayac === "object" && v.sayac ? { ...v.sayac } : {} };
}

/**
 * Açık YEREL_MUDAHALE uyarısına nedenleri işler (yoksa açar); YENİ her neden için bildirim AYNI tx'te. Kurulum kilidi
 * altında çağrılır. Dönüş: güncel uyarı (neden yoksa null — hiçbir şey yazılmaz).
 */
export async function recordLocalInterventionTx(
  tx: Tx,
  g: {
    readonly installationDbId: string;
    readonly causes: readonly LocalInterventionCause[];
    readonly sides: { readonly owner: Fingerprint; readonly other: Fingerprint };
    readonly measurements: { readonly sira: number | null | undefined; readonly lastSeenSequence: number | null; readonly uncertaintyMs?: number; readonly skewSeconds?: number };
    readonly nowMs: number;
  },
): Promise<KopyaUyarisi | null> {
  if (g.causes.length === 0) return null;
  const open = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: g.installationDbId, tur: "YEREL_MUDAHALE", durum: "ACIK" } });
  const detail = readDetail(open?.ayrinti);
  const fresh = g.causes.filter((c) => !detail.nedenler.includes(c));
  for (const c of g.causes) detail.sayac[c] = (detail.sayac[c] ?? 0) + 1;
  const ayrinti: Prisma.InputJsonObject = {
    nedenler: [...detail.nedenler, ...fresh],
    sayac: detail.sayac,
    sonSira: g.measurements.sira ?? null,
    oncekiSira: g.measurements.lastSeenSequence,
    ...(g.measurements.uncertaintyMs === undefined ? {} : { belirsizlikMs: g.measurements.uncertaintyMs }),
    ...(g.measurements.skewSeconds === undefined ? {} : { sapmaSn: g.measurements.skewSeconds }),
  };
  const at = new Date(g.nowMs);
  const alert = open
    ? await tx.kopyaUyarisi.update({
        where: { id: open.id },
        data: { sonGorulme: at, gorulmeSayisi: { increment: 1 }, digerParmakIzi: g.sides.other, ayrinti },
      })
    : await tx.kopyaUyarisi.create({
        data: {
          kurulumId: g.installationDbId,
          tur: "YEREL_MUDAHALE",
          ilkGorulme: at,
          sonGorulme: at,
          sahipParmakIzi: g.sides.owner,
          digerParmakIzi: g.sides.other,
          ayrinti,
        },
      });
  for (const cause of fresh) {
    await enqueueNotificationTx(tx, {
      event: "YEREL_MUDAHALE_SUPHESI",
      keyParts: [alert.id, cause],
      installationDbId: g.installationDbId,
      relatedId: alert.id,
      portalPath: "/kopya-uyarilari",
      referans: LOCAL_INTERVENTION_CAUSE_LABELS[cause],
      tarih: at,
    });
  }
  return alert;
}

/**
 * YABANCI HAK (§2.2-3, K2 önlemi): sunulan HAK bu kurulumun HAK defterinde (kimlik + sürüm) yoksa ya da fabrika bayt
 * özetini bildirip (`hak.ozet`) özet defterdekiyle ve teslim edilen belgeyle tutmuyorsa — satıcı dışında basılmış HAK.
 * Özet bildirmeyen eski fabrikada yalnız kimlik + sürüm sorulur (aynı kimlikle sahte HAK ancak özetle KESİN ayrılır).
 */
export async function isForeignEntitlement(
  tx: Tx,
  g: {
    readonly installation: Pick<Kurulum, "id">;
    /** Bu yanıtla teslim edilecek HAK sürümü (`entitlementForDelivery`). */
    readonly delivered: { readonly hakId: string; readonly surum: number; readonly belge: string };
    readonly client: { readonly hakId: string; readonly surum: number; readonly ozet?: string } | null;
  },
): Promise<boolean> {
  const c = g.client;
  if (!c) return false;
  const version = await tx.hakSurumu.findFirst({
    where: { hakId: c.hakId, surum: c.surum, hak: { kurulumId: g.installation.id } },
    select: { belge: true },
  });
  if (!version) return true;
  if (c.ozet === undefined || jwsDigest(version.belge) === c.ozet) return false;
  const isDeliveredVersion = c.hakId === g.delivered.hakId && c.surum === g.delivered.surum;
  return !(isDeliveredVersion && jwsDigest(g.delivered.belge) === c.ozet);
}
