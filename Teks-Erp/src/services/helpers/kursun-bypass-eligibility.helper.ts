// =============================================================================
// TeksERP — Kurşun Bypass UYGUNLUK Helper
// =============================================================================
// "Bu PROCESS_QC adımı bypass rejimine (kâğıt akışı + Tambur kapanışı)
// ÇEVRİLEBİLİR Mİ?" sorusunun TEK kaynağı.
//
// NEDEN AYRI DOSYA: aynı kuralı artık İKİ taraf soruyor ve cevapları AYNI olmak
// zorunda —
//   • `kursun-bypass.service.listDistribution` → planlamacıya "Ata" butonunu
//     açar/kapatır (TOPLU: N adım, tek turda sinyal sorguları).
//   • `kursun-qc.service` → kurşun TABLETİNİN yazma yollarını kapatır ve kart
//     okutulduğunda salt-okunur bilgi ekranını tetikler (TEKİL: 1 adım).
// Kural iki yerde kopyalansaydı, biri değişip diğeri kalınca ekranda "Ata"
// görünürken tablet de yazabilir (ya da tersi: hiçbiri yapamaz) duruma düşerdi.
//
// ⚠️ KURAL SIRALIDIR ve sıra ANLAMLIDIR: ilk düşen sebep kullanıcıya gösterilir.
// Genelden özele gider (adım kapanmış → veri eksik → dijital iz → rota) çünkü
// "adım kapanmış" bir adımda "KK2 kaydı var" demek doğru ama YARDIMCI DEĞİLDİR.
//
// NEDEN `kursun-bypass-guard.helper` İÇİNE KONMADI: o dosya `inventory.service`
// ve `workorder.service` tarafından da import ediliyor ve yalnız Prisma'ya bağlı
// üç küçük yüklem taşıyor. Uygunluk kuralı ise rota/sinyal yüklemesi yapan daha
// ağır bir okuma katmanı — ikisini karıştırmak, hafif guard'ı kullanan üç
// servise gereksiz bir bağımlılık ağacı taşırdı.
// =============================================================================

import {
  Prisma,
  RollOperationType,
  StationKind,
  StepStatus,
  type PrismaClient,
} from "@prisma/client";
import { ACTIVE_OPERATION } from "./roll-operation.helper";
import { AppError } from "../../utils/app-error";
import { resolveKursunBypassEnabled } from "../system-setting.service";
import {
  assertStepNotBypassAssigned,
  KURSUN_BYPASS_MARKER_PREFIX,
} from "./kursun-bypass-guard.helper";
import { STEP_QUALITY_SELECT, stepCanApplyQuality } from "./quality-station.helper";

/** Hem havuz client'ı hem transaction client'ı kabul eden okuma tipi (any YOK). */
type Db = PrismaClient | Prisma.TransactionClient;

/** Rotadaki bir adımın sıralı listesi için minimum şekil (kind + status yeter). */
export interface RouteStepRef {
  id: string;
  stepSequence: number;
  status: StepStatus;
  station: { kind: StationKind; name: string };
}

/**
 * Verilen adımdan SONRAKİ ilk NON-SKIPPED adım (yoksa null = son adım).
 *
 * SKIPPED atlanır çünkü SKIPPED terminaldir: `recomputeStepStatus` ona dokunmaz,
 * oraya bağlanan top akışta görünmez ve WO tamamlanamaz (F76 emsali).
 */
export function nextNonSkippedStep(
  steps: RouteStepRef[],
  stepId: string,
): RouteStepRef | null {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  return steps.slice(idx + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null;
}

/**
 * Uygunluk kuralının okuduğu adım şekli. `movements` AÇIK hareketlerdir
 * (`exitedAt: null`) — kapanmış hareketler ayrı bir sinyaldir (aşağı).
 */
export interface BypassEligibilityStep {
  id: string;
  status: StepStatus;
  movements: Array<{ qtyIn: Prisma.Decimal }>;
  workOrder: { steps: RouteStepRef[] };
}

/**
 * Adım kimliğinden dijital-iz sinyalleri. Üç küme de TOPLU sorgulanır (N+1 yok);
 * tekil çağrıda da aynı sorgular tek elemanlı dizi ile koşar — kural fonksiyonu
 * "kaç adım" olduğunu bilmez, bilmemeli.
 */
export interface BypassEligibilitySignals {
  closedNonBypassSteps: Set<string>;
  qc2Steps: Set<string>;
  errorSteps: Set<string>;
}

/**
 * Üç dijital-iz sinyalini toplu yükler.
 *
 * ⚠️ `closedNonBypass` sorgusunda `notes IS NULL` AYRI daldır: SQL'de
 * `NOT (notes LIKE 'x%')` null'da NULL döner ve satırı SESSİZCE eler — oysa
 * notsuz kapanış da bypass DIŞIDIR (en tipik hâli: eski manuel taşıma).
 */
export async function loadBypassEligibilitySignals(
  db: Db,
  stepIds: string[],
): Promise<BypassEligibilitySignals> {
  if (stepIds.length === 0) {
    return {
      closedNonBypassSteps: new Set(),
      qc2Steps: new Set(),
      errorSteps: new Set(),
    };
  }

  // Sıralı okuma — `tx.*` ile `Promise.all` YASAK (pg adapter tek connection'ı
  // seri çalıştırır; ESLint kuralı da yakalar). Üç sorgu da indexli ve `distinct`.
  const closedNonBypass = await db.rollMovement.findMany({
    where: {
      workOrderStepId: { in: stepIds },
      exitedAt: { not: null },
      OR: [
        { notes: null },
        { notes: { not: { startsWith: KURSUN_BYPASS_MARKER_PREFIX } } },
      ],
    },
    select: { workOrderStepId: true },
    distinct: ["workOrderStepId"],
  });

  const qc2Ops = await db.rollOperation.findMany({
    where: { ...ACTIVE_OPERATION,
      workOrderStepId: { in: stepIds },
      operationType: RollOperationType.QC2_COMPLETED,
      // Tambur kalıtımı (inheritedFromParentRollId) FİİLEN yapılmış QC2 değildir.
      inheritedFromParentRollId: null,
    },
    select: { workOrderStepId: true },
    distinct: ["workOrderStepId"],
  });

  const errorRows = await db.rollError.findMany({
    where: { detectedAtStepId: { in: stepIds } },
    select: { detectedAtStepId: true },
    distinct: ["detectedAtStepId"],
  });

  return {
    // `RollMovement.workOrderStepId` / `RollOperation.workOrderStepId` NOT NULL;
    // `RollError.detectedAtStepId` NULLABLE → yalnız o süzülür.
    closedNonBypassSteps: new Set(closedNonBypass.map((m) => m.workOrderStepId)),
    qc2Steps: new Set(qc2Ops.map((o) => o.workOrderStepId)),
    errorSteps: new Set(
      errorRows.map((e) => e.detectedAtStepId).filter((x): x is string => x !== null),
    ),
  };
}

/**
 * UYGUNLUK KURALI — saf fonksiyon, TEK KAYNAK.
 *
 * @returns engel sebebi (kullanıcıya gösterilecek Türkçe metin) ya da `null`
 *          (uygun: adım bypass rejimine çevrilebilir).
 */
export function resolveBypassBlockReason(
  step: BypassEligibilityStep,
  signals: BypassEligibilitySignals,
): string | null {
  if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
    return "Adım kapanmış (tamamlandı/atlandı)";
  }
  if (step.movements.some((m) => m.qtyIn.lte(0))) {
    return "Ölçümsüz açık kumaş var (metrajı girilmemiş top)";
  }
  if (signals.closedNonBypassSteps.has(step.id)) {
    return "Bu adımda bypass dışı kapanmış hareket var (KK2 kapatma / manuel taşıma)";
  }
  if (signals.qc2Steps.has(step.id)) {
    return "Bu adımda KK2 kaydı var — iş dijital olarak işlenmiş";
  }
  if (signals.errorSteps.has(step.id)) {
    return "Bu adımda hata kaydı açılmış — kâğıt akışına çevrilemez";
  }
  const next = nextNonSkippedStep(step.workOrder.steps, step.id);
  if (next && next.station.kind !== StationKind.TAMBUR) {
    return `Kurşundan sonraki adım Tambur değil (${next.station.name}) — bypass kapanışını yapacak istasyon yok`;
  }
  return null;
}

/**
 * TEKİL adım için uygunluk — yükleme + sinyal + kural, tek çağrıda.
 *
 * Kurşun tabletinin yolu bunu kullanır (`kursun-qc.service`): hem kart
 * okutulduğunda salt-okunur bilgi ekranını tetikler hem de yazma guard'ını
 * besler. Adım bulunamazsa / kalite yürütmüyorsa `null` döner — "uygun değil"
 * DEMEK DEĞİLDİR, "bu soru bu adım için anlamsız" demektir; çağıran ayırt eder.
 */
export async function resolveStepBypassEligibility(
  db: Db,
  stepId: string,
): Promise<{ eligible: boolean; blockReason: string | null } | null> {
  const step = await db.workOrderStep.findUnique({
    where: { id: stepId },
    select: {
      id: true,
      status: true,
      // ⚠️ `STEP_QUALITY_SELECT` — yüklem `appliesQuality`yi de okur; select
      // genişletilmezse Prisma tipi tutmaz.
      station: { select: STEP_QUALITY_SELECT },
      movements: {
        where: { exitedAt: null },
        select: { qtyIn: true },
      },
      workOrder: {
        select: {
          steps: {
            orderBy: { stepSequence: "asc" },
            select: {
              id: true,
              stepSequence: true,
              status: true,
              station: { select: { kind: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!step || !stepCanApplyQuality(step.station)) return null;

  const signals = await loadBypassEligibilitySignals(db, [step.id]);
  const blockReason = resolveBypassBlockReason(step, signals);
  return { eligible: blockReason === null, blockReason };
}

/**
 * KURŞUN TABLETİNİN YAZMA KAPISI — PROCESS_QC'deki her tablet yazma yolu bunu
 * çağırır (KK2 tamamlama, hata kaydı, tablet adım kapatma, açık kumaş açma,
 * kurşun bitirme). `assertStepNotBypassAssigned`'ın YERİNE geçer, onu içerir.
 *
 * ÜÇ DAL (2026-08-05 ürün kararı — "bayrak açıkken kurşun istasyonu yalnız
 * bilgi görür, hiçbir yetkisi yoktur"):
 *
 *  1. Adım bir kurşun makinesine DAĞITILMIŞ → 409. (Eskisiyle birebir aynı
 *     mesaj/davranış; iş kâğıtta yürüyor, kapanışı Tambur yapar.)
 *  2. Bayrak AÇIK **ve** adım dağıtıma UYGUN → 409. Kural neden "uygun" ile
 *     sınırlı: bayrak açıkken körlemesine her adımı kilitlemek ÇIKMAZ üretir —
 *     kurşundan sonra Tambur GELMEYEN rotalarda (kurşun → zımpara → tambur)
 *     bypass kapanışını yapacak istasyon yoktur, yani iş ne tablette işlenebilir
 *     ne de dağıtılabilirdi. Uygunluk kuralı zaten tam olarak "bu adımı bypass
 *     rejimi taşıyabilir mi" sorusunu yanıtlıyor; kilidi ona bağlamak tek
 *     tutarlı yanıttır.
 *  3. Bayrak KAPALI **veya** adım uygun DEĞİL → serbest (bugünkü akış).
 *
 * MALİYET: bayrak kapalıyken tek EK sorgu (ayar okuması) — fabrika bugün böyle
 * çalışıyor. Açıkken uygunluk yüklemesi de koşar; o rejimde bu yazma yolları
 * zaten reddedilecek olduğu için maliyet doğru yere düşer.
 *
 * ⚠️ Bu guard UI'ya güvenmez ve güvenemez: kurşun tableti OFFLINE kuyruk taşır,
 * bayrak çevrildikten sonra flush edilen eski bir istek ekranı hiç görmeden
 * gelir. Kapı sunucuda olmak zorunda.
 *
 * @param actionLabel Kullanıcıya gösterilecek eylem adı ("KK2 tamamlama" gibi).
 */
export async function assertKursunTabletMayWrite(
  db: Db,
  stepId: string,
  actionLabel: string,
): Promise<void> {
  // 1) Dağıtılmış mı? Daha SOMUT bir cevaptır (makine adı + iki çıkış yolu) →
  //    önce sorulur, aksi halde genel rejim mesajı onu gölgelerdi.
  await assertStepNotBypassAssigned(db, stepId, actionLabel);

  // 2) Rejim kapısı. Bayrak kapalıysa burada biter — ek yükleme YOK.
  const flagEnabled = await resolveKursunBypassEnabled(db);
  if (!flagEnabled) return;

  const eligibility = await resolveStepBypassEligibility(db, stepId);
  // `null` = adım yok ya da PROCESS_QC değil → bu guard'ın sorusu anlamsız.
  // Çağıranın kendi kontrolleri (assertWoAtStepKind vb.) zaten hata üretir;
  // burada karar vermek yanlış hatayı öne geçirirdi.
  if (!eligibility?.eligible) return;

  throw AppError.conflict(
    `Kurşun dağıtımı açık — ${actionLabel} kurşun tabletinden yapılamaz. Bu iş emri Kurşun Planlama ekranından bir kurşun makinesine dağıtılır ve Tambur'da kart okutulduğunda kapanır.`,
  );
}
