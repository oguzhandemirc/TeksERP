// YOKLAMA RAPORU → ZİNCİR SAHİBİ (lisans v2): yalnız zincir sahibinin (çatal değil) yoklaması kurulumun bildirdiği
// yetenekleri ve durum kaydı sırasını satıcıya yazar ve yerel müdahale nedenlerini değerlendirir (yalnız uyarı).
// Yetenek bildirmeyen yoklama kümeyi BOŞALTIR: eski sürüme dönen fabrikaya daraltan biçim (kapanış kirası, ara imzalı
// HAK) gitmez. Küme değişimi kurulum kaydına satırdır (yükseltme/geri dönüş izi).
import type { Kurulum, Prisma } from "@prisma/client";
import type { Fingerprint, PollRequest } from "../lisans-protokol";
import type { Tx } from "../lib/prisma";
import { localInterventionCauses, recordLocalInterventionTx, storableSequence, type PollV2Report } from "./local-intervention";

const EMPTY_REPORT: PollV2Report = { capabilities: [], stateRecord: undefined, uncertainty: undefined, lostFactors: undefined };

async function recordCapabilityChange(tx: Tx, inst: Kurulum, capabilities: readonly string[], kid: string): Promise<void> {
  const before = [...inst.yetenekler].sort();
  const after = [...capabilities].sort();
  if (before.length === after.length && before.every((c, i) => c === after[i])) return;
  await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay: "YETENEKLER", anahtarKimligi: kid, ayrinti: { onceki: before, yeni: after }, yapan: "kurulum" } });
}

/** Kurulum kilidi altında: yerel müdahale + yetenek kaydı; dönüş uç ilerletmesiyle AYNI atomik güncellemeye girer. */
export async function applyOwnerReportTx(
  tx: Tx,
  g: {
    readonly installation: Kurulum;
    readonly kid: string;
    readonly report: PollV2Report | undefined;
    readonly status: Pick<PollRequest["durum"], "nedenler">;
    readonly clock: Pick<PollRequest["saat"], "saticiSapmaSn">;
    readonly sides: { readonly owner: Fingerprint; readonly other: Fingerprint };
    /** Genişlik kapısı bu yoklamada tuttu — YETENEK_DUSUSU nedeni. */
    readonly capabilityDowngrade?: boolean;
    readonly nowMs: number;
  },
): Promise<Prisma.KurulumUncheckedUpdateManyInput> {
  const inst = g.installation;
  const report = g.report ?? EMPTY_REPORT;
  const causes = localInterventionCauses({
    lastSeenSequence: inst.sonDurumSirasi,
    report,
    findings: g.status.nedenler,
    vendorSkewSeconds: g.clock.saticiSapmaSn,
    capabilityDowngrade: g.capabilityDowngrade ?? false,
  });
  await recordLocalInterventionTx(tx, {
    installationDbId: inst.id,
    causes,
    sides: g.sides,
    measurements: { sira: report.stateRecord?.sira, lastSeenSequence: inst.sonDurumSirasi, uncertaintyMs: report.uncertainty?.birikenMs, skewSeconds: g.clock.saticiSapmaSn },
    nowMs: g.nowMs,
  });
  await recordCapabilityChange(tx, inst, report.capabilities, g.kid);
  const sequence = storableSequence(report.stateRecord);
  return { yetenekler: [...report.capabilities], sonKayipEtkenler: [...(report.lostFactors ?? [])], ...(sequence === undefined ? {} : { sonDurumSirasi: sequence }) };
}
