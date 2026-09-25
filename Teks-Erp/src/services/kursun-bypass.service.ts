// =============================================================================
// TeksERP — Kurşun Dağıtım (Kurşun Bypass) Service
// =============================================================================
// Fabrika kurşun makinelerine TABLET KOYMUYOR. Kurşun işlemi fiziksel olarak
// yapılır ama dijital izlenmez (hatalar kâğıda yazılır). Yetkili personel,
// kurşun adımında bekleyen iş emrini bu ekrandan fiziksel bir kurşun
// MAKİNESİNE ATAR; adım daha sonra iki yoldan biriyle kapanır:
//   • Tambur tabletinde refakat kartının karekodu okutulur → önizleme + onay
//     (completeFromTambur) → toplar Tambur adımına geçer, KALİTE NULL kalır
//     (kaliteyi Tambur belirler).
//   • Kurşun rotanın SON adımıysa dağıtım ekranındaki "İşi Bitir"
//     (completeFromDistribution) → finalizeRollsAtLastStep → WAREHOUSE.
//
// ⚠️ ATAMA MAKİNE BAZINDADIR — İSTASYON BAZINDA DEĞİL. Fabrikada PROCESS_QC
// türünde TEK istasyon vardır (KURSUN_KK2) ve altında N adet fiziksel kurşun
// MAKİNESİ (`Machine`) durur; dağıtımcının seçtiği şey o makinelerden biridir.
// Üç sonucu:
//   • `WorkOrderStep.stationId` REPOINT EDİLMEZ. İstasyon tek olduğu için adımın
//     istasyonu hiç değişmiyor; atama bilgisi ADIMDA değil ATAMA SATIRINDA
//     yaşar. (`WorkOrderStep`'e `machineId` kolonu da EKLENMEDİ — bilinçli.)
//   • Kapanan kurşun movement'ı `RollMovement.machineId = ATANAN MAKİNE` ile
//     damgalanır → makine bazlı hacim raporları hiçbir ek kod olmadan çalışır.
//   • İstasyon yetenekleri MAKİNENİN İSTASYONUNDAN okunur (`machine.stationId`).
//
// ⚠️ BU "SKIPPED" DEĞİLDİR. Adım atlanmaz: `RollMovement`'lar normal şekilde
// kapanır (qtyOut=qtyIn) ve `recomputeStepStatus` adımı COMPLETED yapar. Fark:
//   • `RollOperation` (QC2_COMPLETED / KURSUN_APPLIED) YAZILMAZ — kimse tablette
//     "bu topun kalitesini gördüm" demedi, yalan iz bırakmayız.
//   • `RollError` açılmaz (hatalar kâğıtta).
//   • İstasyon yetenekleri (copyStationCapabilitiesToRoll) YİNE kopyalanır —
//     KURSUN özelliği fiziksel olarak uygulandı, topta görünmeli.
// İz üçlüsü: movement notes marker'ı `KURSUN_BYPASS_FINISHED:<uuid>` +
// `KursunBypassAssignment` satırı + audit kaydı.
//
// AYAR: `production.kursunBypassEnabled` (varsayılan KAPALI) YALNIZ YENİ ATAMA
// OLUŞTURMAYI kapılar. Dağıtılmış WO'lar bayrak sonradan kapansa da bypass ile
// biter — rejim ATAMA SATIRINDA kalıcıdır, ayarda değil.
//
// ⚠️ IMPORT DÖNGÜSÜ: bu servis `kursun-qc.service` ya da `tambur.service`'i
// İMPORT ETMEZ (tambur.service bunu import edecek). Ortak guard'lar
// `helpers/kursun-bypass-guard.helper.ts` dosyasında yaşar.
// =============================================================================

import { ACTIVE_OPERATION, OWN_OPERATION } from "./helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "./helpers/roll-movement.helper";
import { randomUUID } from "crypto";
import { normalizeScanCode } from "../utils/code-format";
import {
  KursunBypassCompletionSource,
  Prisma,
  type PrismaClient,
  RollOperationType,
  StationKind,
  StationPropertyMode,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { p2002Mentions } from "../utils/p2002";
import { resolveKursunBypassEnabled } from "./system-setting.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { copyStationCapabilitiesToRoll } from "./helpers/station-capability-transfer.helper";
import { finalizeRollsAtLastStep } from "./helpers/roll-finalize.helper";
import { uyari } from "../lib/logger";
import {
  completeWorkOrderIfStepsDone,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import {
  findPendingBypassAssignmentTx,
  KURSUN_BYPASS_MARKER_PREFIX,
} from "./helpers/kursun-bypass-guard.helper";
import {
  loadBypassEligibilitySignals,
  nextNonSkippedStep,
  resolveBypassBlockReason,
  type RouteStepRef,
} from "./helpers/kursun-bypass-eligibility.helper";
import {
  QUALITY_STATION_WHERE,
  STEP_QUALITY_SELECT,
  stepCanApplyQuality,
} from "./helpers/quality-station.helper";

/**
 * Bypass kapanışının movement notes marker ÖN EKİ. Tur kimliği (uuid) suffix
 * olarak eklenir — QC2_STEP_FINISHED emsali: aynı adımda çok-parti kapanışları
 * (fason 2. tur) birbirine karışmasın.
 *
 * TEK KAYNAK `helpers/kursun-bypass-guard.helper.ts`'tedir (`inventory.service`
 * de okuyor ve bu servisi import edemiyor); buradan yalnız yeniden ihraç edilir
 * ki mevcut çağrı yerleri (test scripti dahil) kırılmasın.
 */
export { KURSUN_BYPASS_MARKER_PREFIX };

/**
 * DAĞITILMADAN yapılan kapanışın marker ön eki (2026-08-06).
 *
 * ⚠️ `KURSUN_BYPASS_MARKER_PREFIX` ile BAŞLAMAK ZORUNDA. Ön eki bağımsız bir
 * değer yapmak sessiz bir regresyon üretirdi: `hasBypassClosureOnQualityStepTx`
 * (inventory) ve `loadBypassEligibilitySignals.closedNonBypass` bu satırları
 * `startsWith(KURSUN_BYPASS_MARKER_PREFIX)` ile tanıyor — eşleşme kopsaydı
 * çok-partili işin İKİNCİ turu "bu adımda bypass dışı kapanmış hareket var"
 * diye uygunluğunu kaybeder ve iş yeniden çıkmaza düşerdi.
 *
 * Tam değer: `KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid>`.
 */
export const KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX = `${KURSUN_BYPASS_MARKER_PREFIX}:UNASSIGNED`;

/** Dağıtılmadan kapanış sayacının penceresi (gün). */
const UNASSIGNED_CLOSURE_WINDOW_DAYS = 7;

/** Emniyet tavanı — listQueue emsali. Dolarsa liste kırpılmış olabilir, uyarı loglanır. */
const LIST_CAP = 500;

/** Atama YAPILABİLİR WO durumları (terminal WO'ya dağıtım yok). */
const ASSIGNABLE_WO_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
];

/**
 * AÇIK (bekleyen) atama = ne tamamlanmış ne iptal edilmiş. TEK KAYNAK —
 * `listDistribution` liste kaynağı ile `getVisibility` sayacı aynı kümeyi
 * saymalı, aksi halde menü "iş var" derken liste boş çıkar.
 */
const PENDING_ASSIGNMENT_WHERE = {
  completedAt: null,
  cancelledAt: null,
} satisfies Prisma.KursunBypassAssignmentWhereInput;

/**
 * `waiting` kümesinin ORTAK gövdesi: kurşun adımı + adımda açık top var + WO
 * canlı (terminal CANCELLED/SUPERSEDED ve kapanmış COMPLETED dışarıda).
 *
 * "Açık atama YOK" koşulu BİLİNÇLİ olarak burada DEĞİL — iki çağıran onu iki
 * farklı yoldan ifade eder ve ikisi de doğrudur:
 *   • `listDistribution` açık atamaları zaten satır satır yüklediği için
 *     `id: { notIn: pendingStepIds }` ile eler (ekstra sorgu yok).
 *   • `getVisibility` hiçbir satır yüklemez → `kursunBypasses: { none: ... }`
 *     ile tek sorguda eler (LIST_CAP kırpmasına da bağımlı değildir).
 */
const WAITING_STEP_BASE_WHERE = {
  station: { ...QUALITY_STATION_WHERE },
  movements: { some: { ...ACTIVE_MOVEMENT, exitedAt: null } },
  workOrder: { status: { in: ASSIGNABLE_WO_STATUSES } },
} satisfies Prisma.WorkOrderStepWhereInput;

// -----------------------------------------------------------------------------
// Payload tipleri (Electron + mobil AYNI payload'ı tüketir — mobile'a ayrı
// makine servisi gerekmesin diye MAKİNE listesi de bu yanıtta gelir).
// -----------------------------------------------------------------------------

/** Dağıtılabilir fiziksel kurşun makinesi (PROCESS_QC istasyonuna bağlı, aktif). */
export interface KursunBypassMachineOption {
  id: string;
  code: string;
  name: string;
  /** Makinenin bağlı olduğu istasyon — yetenek okuması bu id üzerinden yapılır. */
  stationId: string;
  stationName: string;
}

/** Dağıtım ekranındaki bir satırın ORTAK gövdesi (waiting + assigned). */
export interface KursunDistributionRowBase {
  workOrderStepId: string;
  workOrderId: string;
  workOrderNumber: string;
  /**
   * Adımdaki AÇIK topların DISTINCT parti numaraları — planlamacı "hangi iş emri
   * ve hangi partiler" sorusunu tek bakışta yanıtlasın. Partisiz top varsa liste
   * kısalır (null'lar atlanır).
   */
  batchNumbers: string[];
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  /** Açık topların TOPLAM güncel metrajı (Decimal ile toplanır, float drift yok). */
  totalMeters: number;
  oldestEnteredAt: Date | null;
  isUrgent: boolean;
  urgentMarkedAt: Date | null;
  /** Kurşun rotanın son (non-SKIPPED) adımı mı → "İşi Bitir" butonu bu satırda çıkar. */
  isLastStep: boolean;
}

export interface KursunDistributionWaitingRow extends KursunDistributionRowBase {
  /** Bu adım bypass'a dağıtılabilir mi? */
  eligible: boolean;
  /** Uygunluk kurallarından HANGİSİ düştü — somut sebep (null = uygun). */
  blockReason: string | null;
}

export interface KursunDistributionAssignedRow extends KursunDistributionRowBase {
  /**
   * `WorkOrderStep.priority` — MAKİNE İÇİ sıra. Sürükle-bırak bunu yeniden yazar
   * (`PATCH /kursun-qc/queue/reorder`, `waiting` ile AYNI uç ve AYNI alan).
   *
   * Çakışma YOK: bir adım aynı anda ya bekleyendir ya bir makinededir ya da
   * tablet `open-cards` listesindedir — üçü birbirini dışlar. Sıralama yalnız o
   * kümenin kendi satırlarını yeniden numaralar.
   */
  priority: number;
  assignmentId: string;
  /** ATANAN fiziksel kurşun makinesi — izleme/gruplama bu alan üzerinden yapılır. */
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Makinenin istasyonu (pratikte hep tek PROCESS_QC istasyonu) — bağlam bilgisi. */
  stationId: string;
  stationName: string;
  assignedAt: Date;
  assignedByName: string | null;
  notes: string | null;
  /** Atama artık anlamsız (adım kapandı / açık top kalmadı) → UI "iptal et" önerir. */
  stale: boolean;
  staleReason: string | null;
}

/**
 * "Son N günde kaç iş DAĞITILMADAN Tambur'da kapandı" sayacı.
 *
 * Dağıtım artık işin ön koşulu değil (2026-08-06); ama disiplinin sessizce
 * erimesi de doğru değil — dağıtılmadan kapanan her iş makine bazlı hacim
 * raporunda ATIFSIZ kalır. Bu sayaç planlamacıya o kaybı görünür kılar.
 *
 * ⚠️ KAYNAK `SystemLog` DEĞİL, movement marker'ıdır: `archive-scheduler` audit
 * satırlarını 6 ayda bir arşive TAŞIR (kök CLAUDE.md, `Roll.entryReason`
 * emsali) ve sayaç sessizce sıfırlanırdı.
 */
export interface KursunUnassignedClosureStats {
  /** Pencere (gün) — sabit; istemci metni bundan kurar. */
  days: number;
  /** Dağıtılmadan kapanmış DISTINCT kurşun adımı sayısı. */
  stepCount: number;
  /** O adımlarda kapanan toplam top (hareket) adedi. */
  rollCount: number;
}

export interface KursunDistributionPayload {
  /** `production.kursunBypassEnabled` — false ise YENİ atama yapılamaz (mevcutlar biter). */
  flagEnabled: boolean;
  /** Atama hedefleri: PROCESS_QC istasyonlarına bağlı AKTİF kurşun makineleri. */
  machines: KursunBypassMachineOption[];
  waiting: KursunDistributionWaitingRow[];
  assigned: KursunDistributionAssignedRow[];
  /** Son 7 günde dağıtılmadan kapanan işler — bilgi bandı kaynağı. */
  unassignedClosures: KursunUnassignedClosureStats;
}

/**
 * Üç sayılık hafif sayaç ucu — `listDistribution`'ın ağır gövdesini (makineler,
 * satır satır uygunluk/stale hesabı, parti numaraları, metraj toplamları)
 * ödemeden "ne kadar iş var" sorusunu yanıtlar. Sorgu YALNIZ iki `count`.
 *
 * ⚠️ ARTIK MENÜ ÇİZMİYOR (2026-08-05). Eskiden iki kurşun karosunun koşullu
 * görünürlüğünü sürüyordu:
 *   • "Kurşun Sırası"   görünür ⇔ `!flagEnabled || tabletRegimeCount > 0`
 *   • "Kurşun Dağıtım"  görünür ⇔ `flagEnabled  || pendingAssignmentCount > 0`
 * İki ekran "Kurşun Planlama"da birleşti ve karo BAYRAKTAN BAĞIMSIZ hale geldi
 * (yalnız izinle süzülür) → kural her iki istemciden de kalktı.
 *
 * UÇ BİLİNÇLİ OLARAK DURUYOR: sahadaki ESKİ APK'lar bu ucu hâlâ çağırıyor
 * (uygulama öne geldiğinde + modül seçim ekranında). Silmek, backend deploy'u
 * ile APK dağıtımı arasındaki pencerede o tabletlerde 404 üretirdi. Yeni
 * istemciler çağırmaz.
 */
export interface KursunBypassVisibility {
  /** `production.kursunBypassEnabled` — YENİ atama açık mı. */
  flagEnabled: boolean;
  /** Açık dağıtım sayısı (`completedAt IS NULL AND cancelledAt IS NULL`). */
  pendingAssignmentCount: number;
  /**
   * TABLET REJİMİNDE bekleyen kurşun adımı sayısı: `waiting` kümesiyle BİREBİR
   * aynı where (kurşun adımı + açık top + canlı WO + açık atama YOK) — ama
   * uygunluk/blockReason HESAPLANMAZ, yalnız sayılır. Uygun olmayan (dijital iz
   * taşıyan) adım da bu sayıya girer: o adım tam olarak "tablette işlenecek iş"
   * demektir ve planlamacının sırasını görebilmesi gereken şeydir.
   */
  tabletRegimeCount: number;
}

export interface KursunBypassPreviewRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
}

export interface KursunBypassCompletePreview {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  /** İşin ATANDIĞI kurşun makinesi (onay ekranında "hangi makinede" yazar). */
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi (tek PROCESS_QC istasyonu). */
  stationName: string;
  isLastStep: boolean;
  canComplete: boolean;
  blockReason: string | null;
  rollCount: number;
  totalMeters: number;
  rolls: KursunBypassPreviewRoll[];
  willFinalize: {
    targetStatus: "WAREHOUSE";
    /** Kalite bypass'ta ASLA yazılmaz — "Belirsiz" kalır (finalize WAREHOUSE'a çeker). */
    qualityStaysNull: true;
    /** Barkodsuz açık kumaşa finalize sırasında üretilecek barkod adedi. */
    barcodesToGenerate: number;
  };
  /** Bu tamamlama iş emrini de COMPLETED yapacak mı (başka açık adım kalmıyorsa). */
  workOrderWillComplete: boolean;
}

export interface KursunBypassTamburRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
  receiptNo: string | null;
  colorCode: string | null;
  colorName: string | null;
}

/**
 * Tambur okutmasında kapanacak kurşun işinin KAYNAĞI.
 *
 *  • `ASSIGNED`   — planlamacı işi bir kurşun makinesine dağıttı; kapanış o
 *    kararın uygulanmasıdır ve makine atfı BİLİNİR.
 *  • `UNASSIGNED` — dağıtım hiç yapılmadı (personel unuttu) ama adım bypass
 *    rejimine uygun. Kapanış yine yapılır; makine atfı BİLİNMEZ ve uydurulmaz.
 *    Sektör karşılığı milestone confirmation: kilometre taşı (Tambur) onayı
 *    öncesindeki onaylanmamış operasyonu kapatır.
 */
export type KursunBypassTamburSource = "ASSIGNED" | "UNASSIGNED";

export interface KursunBypassTamburContext {
  /**
   * ⚠️ `UNASSIGNED` kaynakta NULL — ortada atama satırı YOKTUR. Bu alanı
   * "kapanış yapılabilir mi" sorusunun cevabı sanma; o soruyu `source` yanıtlar.
   */
  assignmentId: string | null;
  /** Bu bekleyenin kaynağı — istemciler bilgi metnini buna göre dallandırır. */
  source: KursunBypassTamburSource;
  stepId: string;
  /**
   * İşin ATANDIĞI kurşun makinesi — Tambur onay ekranı bunu gösterir.
   * `UNASSIGNED` kaynakta NULL: işi hangi makinenin yaptığı bilinmiyor ve
   * varsayılan bir makineye yazmak makine bazlı hacim raporunu sessizce
   * yanlışlardı (ürün kararı 2026-08-06).
   */
  machineId: string | null;
  machineName: string | null;
  /**
   * Yetenek kopyalamasının okunacağı istasyon. `ASSIGNED`'da makinenin
   * istasyonu, `UNASSIGNED`'da adımın KENDİ istasyonu — fabrikada PROCESS_QC
   * türünde tek istasyon olduğu için ikisi aynı satıra işaret eder.
   */
  stationId: string;
  stationName: string;
  assignedAt: Date | null;
  assignedByName: string | null;
  notes: string | null;
  rollCount: number;
  totalMeters: number;
  /** Tambur onay ekranının hem gösterimi hem `confirm`'e gidecek rollIds kaynağı. */
  rolls: KursunBypassTamburRoll[];
}

// -----------------------------------------------------------------------------
// Ortak yükleyiciler / saf yardımcılar
// -----------------------------------------------------------------------------

/** Adım + WO + açık movement özeti. Dönüş tipi ÇIKARIMLA türetilir (elle tip kopyası yok). */
async function loadDistributionSteps(
  where: Prisma.WorkOrderStepWhereInput,
  orderBy: Prisma.WorkOrderStepOrderByWithRelationInput[],
) {
  return prisma.workOrderStep.findMany({
    where,
    select: {
      id: true,
      status: true,
      stepSequence: true,
      stationId: true,
      isUrgent: true,
      urgentMarkedAt: true,
      // Planlama sırası. `waiting` bunu `orderBy` ile kullanıyor; `assigned`
      // MAKİNE İÇİ sıralama için JS'te sıralanıyor (aşağıdaki `sortByPlanOrder`)
      // — atamalar `assignedAt asc` ile yüklendiği için orderBy yetmez.
      priority: true,
      workOrder: {
        select: {
          id: true,
          workOrderNumber: true,
          status: true,
          targetItem: { select: { name: true } },
          targetColor: { select: { name: true, hex: true } },
          travelerCards: {
            where: { status: TravelerCardStatus.ACTIVE },
            select: { cardNumber: true, barcode: true },
            take: 1,
          },
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
      movements: {
        where: { ...ACTIVE_MOVEMENT, exitedAt: null },
        select: {
          enteredAt: true,
          qtyIn: true,
          roll: {
            select: { currentQty: true, batch: { select: { batchNumber: true } } },
          },
        },
      },
    },
    orderBy,
    take: LIST_CAP,
  });
}

type DistributionStepRow = Awaited<ReturnType<typeof loadDistributionSteps>>[number];

// `RouteStepRef` + `nextNonSkippedStep` + UYGUNLUK KURALI artık
// `helpers/kursun-bypass-eligibility.helper.ts`'te yaşıyor: aynı kuralı kurşun
// TABLETİ de soruyor (salt-okunur bilgi ekranı + yazma guard'ı) ve iki kopya
// zamanla ayrışırdı. Buradan yalnız kullanılır.

/**
 * PLANLAMA SIRASI karşılaştırıcısı — `waiting` listesinin Prisma `orderBy`'ıyla
 * BİREBİR aynı kural, JS tarafında: acil önce → acil işaretleme anı → planlama
 * önceliği → (son eşitlik bozucu) dağıtım anı.
 *
 * `null` acil damgası SONA gider (`nulls: "last"` karşılığı) — aksi halde hiç
 * acil işaretlenmemiş bir satır, acil olanların önüne geçerdi.
 */
function sortByPlanOrder(
  a: { isUrgent: boolean; urgentMarkedAt: Date | null; priority: number; assignedAt: Date },
  b: { isUrgent: boolean; urgentMarkedAt: Date | null; priority: number; assignedAt: Date },
): number {
  if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
  if (a.urgentMarkedAt || b.urgentMarkedAt) {
    if (!a.urgentMarkedAt) return 1;
    if (!b.urgentMarkedAt) return -1;
    const d = a.urgentMarkedAt.getTime() - b.urgentMarkedAt.getTime();
    if (d !== 0) return d;
  }
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.assignedAt.getTime() - b.assignedAt.getTime();
}

/** Kapanmış movement BYPASS turuna mı ait? (marker ön eki ile başlıyor mu) */
function isBypassClosure(notes: string | null): boolean {
  return notes != null && notes.startsWith(KURSUN_BYPASS_MARKER_PREFIX);
}

// -----------------------------------------------------------------------------

export class KursunBypassService {
  // ---------------------------------------------------------------------------
  // GÖRÜNÜRLÜK (menü çizme)
  // ---------------------------------------------------------------------------
  /**
   * İki ekranın "koşullu göster" kararı için ÜÇ SAYI — bkz. `KursunBypassVisibility`.
   *
   * HAFİFLİK SÖZLEŞMESİ: burada `findMany` YOK, satır materyalize edilmez, N+1
   * yok. Bir ayar okuması + iki `count`. Menü her çizildiğinde çağrıldığı için
   * bu uca liste alanı EKLEME — ihtiyaç doğarsa `listDistribution`'ı çağır.
   *
   * Havuz üzerinde `Promise.all` serbesttir (tx DEĞİL — ESLint guard'ı yalnız
   * `tx` client'ını yakalar; üç sorgu üç bağlantıda paralel koşar).
   */
  async getVisibility(): Promise<ApiResponse<KursunBypassVisibility>> {
    const [flagEnabled, pendingAssignmentCount, tabletRegimeCount] = await Promise.all([
      resolveKursunBypassEnabled(),
      prisma.kursunBypassAssignment.count({ where: PENDING_ASSIGNMENT_WHERE }),
      prisma.workOrderStep.count({
        where: {
          ...WAITING_STEP_BASE_WHERE,
          // Dağıtılmış iş TABLET rejiminde değildir — kurşun makinesinde,
          // kâğıtla yürüyor. `listDistribution`'ın `notIn` elemesiyle aynı
          // küme, tek sorguda ve LIST_CAP kırpmasından bağımsız.
          kursunBypasses: { none: PENDING_ASSIGNMENT_WHERE },
        },
      }),
    ]);

    return {
      success: true,
      data: { flagEnabled, pendingAssignmentCount, tabletRegimeCount },
    };
  }

  // ---------------------------------------------------------------------------
  // LİSTE
  // ---------------------------------------------------------------------------
  /**
   * Kurşun Dağıtım ekranının TEK payload'ı: bayrak + MAKİNELER + bekleyenler +
   * dağıtılmışlar. Electron ve mobil AYNI yanıtı tüketir (mobile'ın ayrıca
   * makine servisi çağırması gerekmesin).
   */
  async listDistribution(): Promise<ApiResponse<KursunDistributionPayload>> {
    const flagEnabled = await resolveKursunBypassEnabled();

    // ATAMA HEDEFLERİ = KALİTE yürüten istasyona bağlı AKTİF makineler.
    // Filtre `assign`'ın kabul koşuluyla BİREBİR aynı tutulur (aktif makine +
    // istasyon kalite yürütüyor) — aksi halde listede görünen bir makine
    // seçildiğinde 400 alınır ve dağıtımcı sebebi anlamaz.
    // ⚠️ Bu filtre ile `assign`ın kabul koşulu (`stepCanApplyQuality`) AYNI
    // ikiz boğazdan beslenir: `QUALITY_STATION_WHERE` ↔ `stepCanApplyQuality`.
    const machineRows = await prisma.machine.findMany({
      where: { isActive: true, station: { ...QUALITY_STATION_WHERE } },
      select: {
        id: true,
        code: true,
        name: true,
        stationId: true,
        station: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }],
    });
    const machines: KursunBypassMachineOption[] = machineRows.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      stationId: m.stationId,
      stationName: m.station.name,
    }));

    // AÇIK atamalar liste kaynağıdır (adımın açık topu kalmasa / adım kapansa
    // bile satır GÖRÜNMELİ — planlamacı "stale" rozetiyle iptal edebilsin).
    const pendingRows = await prisma.kursunBypassAssignment.findMany({
      where: PENDING_ASSIGNMENT_WHERE,
      select: {
        id: true,
        workOrderStepId: true,
        machineId: true,
        assignedAt: true,
        notes: true,
        machine: {
          select: {
            code: true,
            name: true,
            stationId: true,
            station: { select: { name: true } },
          },
        },
        assignedBy: { select: { fullName: true } },
      },
      orderBy: { assignedAt: "asc" },
      take: LIST_CAP,
    });
    if (pendingRows.length === LIST_CAP) {
      uyari("kursun-bypass", `listDistribution: ${LIST_CAP} açık atama tavanına ulaşıldı — liste kırpılmış olabilir.`,
      );
    }
    const pendingStepIds = pendingRows.map((r) => r.workOrderStepId);

    const assignedSteps = pendingStepIds.length
      ? await loadDistributionSteps({ id: { in: pendingStepIds } }, [
          { stepSequence: "asc" },
        ])
      : [];
    const assignedStepById = new Map(assignedSteps.map((s) => [s.id, s]));

    // BEKLEYENLER: PROCESS_QC + açık movement var + açık atama YOK.
    // Terminal WO (CANCELLED/SUPERSEDED) listeye hiç girmez — "uygun değil"
    // satırı olarak göstermek gürültü olurdu; oraya dağıtım zaten anlamsız.
    const waitingSteps = await loadDistributionSteps(
      {
        ...WAITING_STEP_BASE_WHERE,
        ...(pendingStepIds.length ? { id: { notIn: pendingStepIds } } : {}),
      },
      // listQueue ile aynı sıra: acil önce, sonra planlama önceliği.
      [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
    );
    if (waitingSteps.length === LIST_CAP) {
      uyari("kursun-bypass", `listDistribution: ${LIST_CAP} bekleyen adım tavanına ulaşıldı — liste kırpılmış olabilir.`,
      );
    }

    // ── Uygunluk sinyalleri (yalnız bekleyenler için; toplu sorgu, N+1 yok) ──
    // Sorgular da kural da `helpers/kursun-bypass-eligibility.helper`'da: kurşun
    // TABLETİ aynı kuralı tekil olarak soruyor ve iki kopya ayrışırdı.
    const waitingIds = waitingSteps.map((s) => s.id);
    const signals = await loadBypassEligibilitySignals(prisma, waitingIds);

    const waiting: KursunDistributionWaitingRow[] = waitingSteps.map((step) => {
      const base = this.buildRowBase(step);
      const blockReason = resolveBypassBlockReason(step, signals);
      return { ...base, eligible: blockReason === null, blockReason };
    });

    const assigned: KursunDistributionAssignedRow[] = [];
    for (const a of pendingRows) {
      const step = assignedStepById.get(a.workOrderStepId);
      // Adım satırı bulunamazsa (silinmiş rota — pratikte imkânsız, FK RESTRICT)
      // satırı düşürmek yerine atlamak yeterli; UI'da hayalet kayıt istemiyoruz.
      if (!step) continue;
      const base = this.buildRowBase(step);
      let staleReason: string | null = null;
      if (
        step.workOrder.status === WorkOrderStatus.CANCELLED ||
        step.workOrder.status === WorkOrderStatus.SUPERSEDED
      ) {
        // Terminal WO: tamamlama yolları 409 verir (assertWorkOrderAliveTx) —
        // tek çıkış iptal. Bunu satırda söylemezsek planlamacı "İşi Bitir"e basıp
        // anlamsız bir hata alır.
        staleReason = "İş emri iptal/devredilmiş — dağıtımı iptal edin";
      } else if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
        staleReason = "Adım kapanmış — atama artık anlamsız, iptal edin";
      } else if (base.openRollCount === 0) {
        staleReason = "Adımda açık top kalmadı — atama artık anlamsız, iptal edin";
      }
      assigned.push({
        ...base,
        assignmentId: a.id,
        machineId: a.machineId,
        machineCode: a.machine.code,
        machineName: a.machine.name,
        stationId: a.machine.stationId,
        stationName: a.machine.station.name,
        assignedAt: a.assignedAt,
        assignedByName: a.assignedBy?.fullName ?? null,
        notes: a.notes,
        stale: staleReason !== null,
        staleReason,
        priority: step.priority,
      });
    }

    // MAKİNE İÇİ SIRA (2026-08-05). Atamalar `assignedAt asc` ile yükleniyor —
    // yani liste "ne zaman dağıtıldı" sırasındaydı ve planlamacının makinedeki
    // işleri sürükleyip sıralaması EKRANA HİÇ YANSIMAZDI. Artık `waiting` ile
    // AYNI planlama sırası uygulanır; son eşitlik bozucu `startedAt` değil
    // `assignedAt`'tir (dağıtılmış iş için anlamlı olan odur).
    //
    // Sıralama JS'te: kaynak `pendingRows` (atamalar), sıralama anahtarları ise
    // adımda (`WorkOrderStep`) — tek `orderBy` ile ifade edilemez.
    assigned.sort(sortByPlanOrder);

    const unassignedClosures = await this.loadUnassignedClosureStats();

    return {
      success: true,
      data: { flagEnabled, machines, waiting, assigned, unassignedClosures },
    };
  }

  /**
   * "Son N günde kaç iş DAĞITILMADAN kapandı" — planlamacı bandının kaynağı.
   *
   * Dağıtım artık işin ön koşulu değil, ama dağıtılmadan kapanan her iş makine
   * bazlı hacim raporunda ATIFSIZ kalıyor. Sayaç o kaybı görünür tutar; sahada
   * sürekli oluyorsa cevap sayacı gizlemek değil, dağıtım adımını sorgulamaktır.
   *
   * ⚠️ KAYNAK movement marker'ıdır, `SystemLog` DEĞİL: `archive-scheduler` audit
   * satırlarını 6 ayda bir arşive TAŞIR ve sayaç sessizce sıfırlanırdı.
   * `exitedAt` aralığı mevcut `roll_movements_exitedAt_idx`'i kullanır; satır
   * yüklenmez, yalnız `distinct` adım kimlikleri okunur.
   */
  private async loadUnassignedClosureStats(): Promise<KursunUnassignedClosureStats> {
    const since = new Date(
      Date.now() - UNASSIGNED_CLOSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await prisma.rollMovement.findMany({
      where: {
        ...ACTIVE_MOVEMENT,
        exitedAt: { gte: since },
        notes: { startsWith: KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX },
      },
      select: { workOrderStepId: true },
    });
    return {
      days: UNASSIGNED_CLOSURE_WINDOW_DAYS,
      stepCount: new Set(rows.map((r) => r.workOrderStepId)).size,
      rollCount: rows.length,
    };
  }

  /** Adım satırından ortak liste gövdesini üretir (waiting + assigned paylaşır). */
  private buildRowBase(step: DistributionStepRow): KursunDistributionRowBase {
    // Decimal aritmetiği — JS float drift'i yok; serializer number'a çevirir.
    const totalMeters = step.movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );
    const oldest = step.movements.reduce<Date | null>(
      (acc, m) => (acc === null || m.enteredAt < acc ? m.enteredAt : acc),
      null,
    );
    const batchNumbers = [
      ...new Set(
        step.movements
          .map((m) => m.roll.batch?.batchNumber)
          .filter((x): x is string => !!x),
      ),
    ].sort();
    const card = step.workOrder.travelerCards[0] ?? null;
    const next = nextNonSkippedStep(step.workOrder.steps, step.id);

    return {
      workOrderStepId: step.id,
      workOrderId: step.workOrder.id,
      workOrderNumber: step.workOrder.workOrderNumber,
      batchNumbers,
      travelerCardNumber: card?.cardNumber ?? null,
      travelerCardBarcode: card?.barcode ?? null,
      itemName: step.workOrder.targetItem?.name ?? null,
      colorName: step.workOrder.targetColor?.name ?? null,
      colorHex: step.workOrder.targetColor?.hex ?? null,
      openRollCount: step.movements.length,
      totalMeters: totalMeters.toNumber(),
      oldestEnteredAt: oldest,
      isUrgent: step.isUrgent,
      urgentMarkedAt: step.urgentMarkedAt,
      isLastStep: next === null,
    };
  }

  // ---------------------------------------------------------------------------
  // ATAMA
  // ---------------------------------------------------------------------------
  /**
   * İş emrinin kurşun adımını fiziksel bir kurşun MAKİNESİNE atar (ya da zaten
   * dağıtılmışsa başka makineye TAŞIR).
   *
   * NEDEN `step.stationId` REPOINT EDİLMİYOR: PROCESS_QC türünde tek istasyon
   * var, adımın istasyonu zaten hiç değişmiyor. Atamanın taşıdığı tek yeni bilgi
   * MAKİNEDİR ve o bilgi bu satırda (`machineId`) yaşar; üretim atfı ise
   * movement kapanışında `RollMovement.machineId` damgasıyla tutulur
   * (`closeBypassMovementsTx`). Adımın istasyonuna dokunulmadığı için iptalde
   * "geri yükleme" diye bir şey de yoktur.
   */
  async assign(
    input: { workOrderId: string; machineId: string; notes?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      assignmentId: string;
      workOrderId: string;
      workOrderNumber: string;
      workOrderStepId: string;
      machineId: string;
      machineName: string;
      stationId: string;
      stationName: string;
      isLastStep: boolean;
      reassigned: boolean;
    }>
  > {
    // assignedById NOT NULL — anonim atama olamaz (dağıtım bir sorumluluk kaydıdır).
    if (!userId) throw AppError.unauthorized();
    const notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        // 1) O-2 write-skew guard: WO satırını kilitle → eşzamanlı finish/fason/
        //    finalize yollarıyla serileş (kardeşlerle aynı kilit sırası: WO → step).
        await touchWorkOrderTx(tx, input.workOrderId);

        // 2) WO'yu TAZE oku (kilit altında).
        const wo = await tx.workOrder.findUnique({
          where: { id: input.workOrderId },
          select: {
            id: true,
            status: true,
            workOrderNumber: true,
            // `stationId` ÇEKİLMEZ: adımın istasyonuna ne yazılıyor ne de
            // okunuyor (repoint kalktı) — rota kararları yalnız kind üzerinden.
            steps: {
              orderBy: { stepSequence: "asc" },
              select: {
                id: true,
                stepSequence: true,
                status: true,
                station: { select: { ...STEP_QUALITY_SELECT, name: true } },
              },
            },
          },
        });
        if (!wo) throw AppError.notFound("İş emri bulunamadı");
        if (!ASSIGNABLE_WO_STATUSES.includes(wo.status)) {
          throw AppError.conflict(
            `İş emri durumu dağıtıma uygun değil (${wo.status}) — yalnız planlanan/üretimdeki iş emirleri kurşuna dağıtılır.`,
          );
        }

        // 3) Kurşun adımı = stepSequence'a göre İLK KALİTE adımı
        //    (assertWoAtStepKind ile aynı semantik).
        const routeSteps: RouteStepRef[] = wo.steps.map((s) => ({
          id: s.id,
          stepSequence: s.stepSequence,
          status: s.status,
          station: s.station,
        }));
        const step = wo.steps.find((s) => stepCanApplyQuality(s.station));
        if (!step) {
          throw AppError.badRequest("Bu iş emrinde Kurşun + KK2 adımı tanımlı değil");
        }
        if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
          throw AppError.badRequest(
            "Kurşun adımı kapanmış (tamamlandı/atlandı) — dağıtım yapılamaz",
          );
        }

        // 4) Zaten dağıtılmış mı?
        const existingPending = await findPendingBypassAssignmentTx(tx, step.id);

        // 5) BAYRAK YALNIZ YENİ ATAMAYI KAPILAR. Var olan atamanın MAKİNESİNİ
        //    değiştirmek (re-assign) bayrak kapansa da çalışır: rejim atama
        //    satırında kalıcıdır, aksi halde bayrağı kapatmak sahadaki yarım işi
        //    kilitlerdi (iş bir makineden diğerine alınamazdı).
        if (!existingPending) {
          const enabled = await resolveKursunBypassEnabled(tx);
          if (!enabled) {
            throw AppError.badRequest(
              "Kurşun bypass özelliği kapalı — yeni dağıtım yapılamaz. Ayarlardan açın.",
            );
          }
        }

        // 6) UYGUNLUK — hepsi tx içinde TAZE okunur (ön-kontrol ile atama arasında
        //    sahada iş değişmiş olabilir).
        const openMovements = await tx.rollMovement.findMany({
          where: { ...ACTIVE_MOVEMENT, workOrderStepId: step.id, exitedAt: null },
          select: { rollId: true, qtyIn: true },
        });
        // 6a
        if (openMovements.length === 0) {
          throw AppError.badRequest("Kurşun adımında bekleyen top yok");
        }
        // 6b — `createOpenFabricRoll` qtyIn=0 ile top doğurabilir (ölçüm sonraki
        //      istasyonda girilir). Bypass onu 0 metre olarak Tambur'a/depoya
        //      itmemeli: metraj bir daha ASLA sorulmazdı.
        if (openMovements.some((m) => m.qtyIn.lte(0))) {
          throw AppError.badRequest(
            "Ölçümsüz açık kumaş var (metrajı girilmemiş top) — önce metrajı girin",
          );
        }
        // 6c — BYPASS-DIŞI kapanmış movement varsa bu adım dijital olarak
        //      işlenmiş demektir (QC2_STEP_FINISHED / MANUAL_MOVE_* / WO_CLOSE_*).
        //      Kendi marker'ımız MUAF: çok-parti 2. turunda aynı adım yeniden
        //      dağıtılabilmeli.
        const closedMovements = await tx.rollMovement.findMany({
          where: { ...ACTIVE_MOVEMENT, workOrderStepId: step.id, exitedAt: { not: null } },
          select: { notes: true },
        });
        if (closedMovements.some((m) => !isBypassClosure(m.notes))) {
          throw AppError.conflict(
            "Bu adımda bypass dışı kapanmış hareket var (KK2 kapatma / manuel taşıma) — dağıtılamaz",
          );
        }
        // 6d — Tambur kalıtımı (inheritedFromParentRollId) sayılmaz; yalnız bu
        //      adımda FİİLEN yapılmış QC2 engeller.
        const qc2Count = await tx.rollOperation.count({
          where: { ...ACTIVE_OPERATION,
            ...OWN_OPERATION,
            workOrderStepId: step.id,
            operationType: RollOperationType.QC2_COMPLETED,
          },
        });
        if (qc2Count > 0) {
          throw AppError.conflict(
            "Bu adımda KK2 kaydı var — iş dijital olarak işlenmiş, bypass'a dağıtılamaz",
          );
        }
        // 6e
        const errorCount = await tx.rollError.count({
          where: { detectedAtStepId: step.id },
        });
        if (errorCount > 0) {
          throw AppError.conflict(
            "Bu adımda hata kaydı açılmış — kâğıt akışına çevrilemez, önce hataları karara bağlayın",
          );
        }
        // 6f — Kapanışı YAPACAK istasyon var mı? Bypass'ın iki çıkışı vardır:
        //      Tambur okutması ya da son-adım "İşi Bitir". Araya fason/başka
        //      istasyon girerse ne biri ne öteki adımı kapatabilir → mal kilitlenir.
        const next = nextNonSkippedStep(routeSteps, step.id);
        if (next && next.station.kind !== StationKind.TAMBUR) {
          throw AppError.badRequest(
            `Kurşundan sonraki adım Tambur değil (${next.station.name}) — bypass kapanışını yapacak istasyon yok, dağıtım engellendi.`,
          );
        }
        const isLastStep = next === null;

        // 7) Hedef MAKİNE — istasyonu da birlikte çözülür: yetenek okuması ve
        //    tür kontrolü makinenin İSTASYONU üzerinden yapılır (makinenin kendi
        //    "kind"i yoktur, istasyonundan miras alır).
        const machine = await tx.machine.findUnique({
          where: { id: input.machineId },
          select: {
            id: true,
            name: true,
            isActive: true,
            stationId: true,
            station: { select: { name: true, ...STEP_QUALITY_SELECT } },
          },
        });
        if (!machine) throw AppError.notFound("Makine bulunamadı");
        if (!machine.isActive) throw AppError.badRequest("Seçilen makine pasif");
        // ⚠️ `listDistribution`ın makine filtresiyle (QUALITY_STATION_WHERE)
        // BİREBİR aynı kural — ikiz boğazın iki ucu.
        if (!stepCanApplyQuality(machine.station)) {
          throw AppError.badRequest(
            `Seçilen makine kalite kontrol yürüten bir istasyona bağlı değil (bağlı olduğu istasyon: ${machine.station.name})`,
          );
        }

        // 8) YETENEK KONTROLÜ — makinenin İSTASYONU kurşun uygulayabiliyor mu?
        //    NEDEN: bypass kapanışında `copyStationCapabilitiesToRoll` bu
        //    istasyonun yeteneklerini toplara kopyalar. İstasyonda KURSUN
        //    özelliği tanımlı değilse özellik topa hiç geçmez, buna karşılık
        //    `computeWorkOrderLocks` "bu özelliği veren adım tamamlandı" der →
        //    WO kilit modeli yalan söyler. Atama makine bazına indiği için
        //    kontrol de sadeleşti: istasyon zaten tek, "hangi istasyon neyi
        //    karşılıyor" karşılaştırması anlamsız — tek soru kaldı, sebebini
        //    dağıtımcıya söylemek yine değerli.
        //    ⚠️ 2026-08-10: MOD **AUTO** ARANIR, satırın varlığı YETMEZ. Bypass
        //    rejiminde tablet salt-okunurdur — özelliği işaretleyecek bir
        //    operatör YOKTUR, dolayısıyla OPTIONAL/REQUIRED bir KURSUN satırı
        //    kapanışta topa hiç yazılmaz ve yukarıdaki "kilit modeli yalan
        //    söyler" arızası aynen geri gelirdi (bu kez sessizce).
        const kursunCap = await tx.stationProperty.findFirst({
          where: {
            stationId: machine.stationId,
            property: { code: "KURSUN" },
            mode: StationPropertyMode.AUTO,
          },
          select: { id: true },
        });
        if (!kursunCap) {
          throw AppError.badRequest(
            `Seçilen makinenin istasyonu (${machine.station.name}) kurşunu OTOMATİK uygulamıyor — ` +
              `bypass'ta tablette işaretleme yapılmadığı için KURSUN özelliği "Otomatik" modunda olmalı. ` +
              `İstasyon Yetenekleri ekranından düzeltin.`,
          );
        }

        // 9) Atama satırı. ADIM REPOINT YOK — adımın istasyonu (tek PROCESS_QC
        //    istasyonu) değişmiyor; atamanın tek bilgisi makinedir ve o bu
        //    satırda yaşar. Yazma ATOMİK CLAIM ile yapılır (check-then-act yok).
        let assignmentId: string;
        if (existingPending) {
          const claim = await tx.kursunBypassAssignment.updateMany({
            where: { id: existingPending.id, completedAt: null, cancelledAt: null },
            data: { machineId: machine.id, notes },
          });
          if (claim.count === 0) {
            throw AppError.conflict(
              "Bu dağıtım az önce tamamlandı/iptal edildi — listeyi yenileyin.",
            );
          }
          assignmentId = existingPending.id;
        } else {
          const created = await tx.kursunBypassAssignment.create({
            data: {
              workOrderId: wo.id,
              workOrderStepId: step.id,
              machineId: machine.id,
              assignedById: userId,
              notes,
            },
            select: { id: true },
          });
          assignmentId = created.id;
        }

        return {
          assignmentId,
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber,
          workOrderStepId: step.id,
          machineId: machine.id,
          machineName: machine.name,
          stationId: machine.stationId,
          stationName: machine.station.name,
          isLastStep,
          reassigned: existingPending !== null,
          previousMachineId: existingPending?.machineId ?? null,
        };
      });
    } catch (err) {
      // Partial unique `kursun_bypass_one_pending_per_step_uq` = "bir adımda en
      // fazla BİR açık atama" DB seddi. Eşzamanlı iki dağıtımın kaybedeni buraya düşer.
      if (p2002Mentions(err, /kursun_bypass_one_pending_per_step/i)) {
        throw AppError.conflict("Bu iş emri az önce dağıtıldı, listeyi yenileyin");
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: result.reassigned ? "UPDATE" : "CREATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: result.assignmentId,
      newData: {
        event: "KURSUN_BYPASS_ASSIGN",
        workOrderId: result.workOrderId,
        workOrderNumber: result.workOrderNumber,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        stationId: result.stationId,
        stationName: result.stationName,
        previousMachineId: result.previousMachineId,
        reassigned: result.reassigned,
        isLastStep: result.isLastStep,
        notes,
      },
    });

    return {
      success: true,
      data: {
        assignmentId: result.assignmentId,
        workOrderId: result.workOrderId,
        workOrderNumber: result.workOrderNumber,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        stationId: result.stationId,
        stationName: result.stationName,
        isLastStep: result.isLastStep,
        reassigned: result.reassigned,
      },
      message: result.reassigned
        ? `${result.workOrderNumber} dağıtımı "${result.machineName}" makinesine taşındı`
        : `${result.workOrderNumber} "${result.machineName}" makinesine dağıtıldı`,
    };
  }

  // ---------------------------------------------------------------------------
  // TOPLU İŞLEMLER (2026-08-05)
  // ---------------------------------------------------------------------------
  /**
   * ÇOK İŞ EMRİNİ tek çağrıda bir makineye dağıtır (havuzdan seçip atama ve
   * makineler arası TAŞIMA aynı uçtur — `assign` zaten yeniden-atamayı taşıma
   * olarak ele alıyor).
   *
   * ⚠️ TEK BİR TRANSACTION DEĞİL — her iş emri KENDİ tx'inde işlenir ve sonuç
   * PARÇALI olabilir. İki gerekçe:
   *  1. `assign` iş emri satırını kilitliyor (`touchWorkOrderTx`). 50 iş emrini
   *     tek tx'e almak 50 satırı işlem boyunca kilitli tutar — kök kural 10
   *     ("transaction süresi kısa") ihlali ve gerçek bir deadlock riski.
   *  2. Hepsi-ya-hiç yanlış semantik olurdu: listedeki bir iş emri bu arada
   *     uygunluğunu yitirdiyse (tablette dokunuldu, iptal edildi, kapandı)
   *     diğer 49'un dağıtımını geri almak planlamacının niyetine aykırıdır.
   *     Dağıtım zaten geri alınabilir bir karardır (Kaldır).
   *
   * Bu yüzden yanıt SESSİZ DEĞİLDİR: başarısız her satır kendi somut sebebiyle
   * `failed` dizisinde döner ve arayüz onları tek tek gösterir. "42 atandı"
   * demek ama 8'inin neden atlandığını söylememek, en kötü davranıştır.
   */
  async assignBulk(
    input: { workOrderIds: string[]; machineId: string; notes?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      assigned: number;
      /** Bunlardan kaçı BAŞKA bir makineden taşındı (yeni atama değil). */
      moved: number;
      failed: Array<{ workOrderId: string; message: string }>;
    }>
  > {
    if (!userId) throw AppError.unauthorized();

    let assigned = 0;
    let moved = 0;
    const failed: Array<{ workOrderId: string; message: string }> = [];

    // SIRALI koşar (Promise.all DEĞİL): aynı makineye eş zamanlı atama, WO
    // kilitlerini rastgele sırada alıp deadlock üretebilir; ayrıca havuz
    // seçimleri onlarca satırlık olur, yüzlerce değil.
    for (const workOrderId of input.workOrderIds) {
      try {
        const res = await this.assign(
          { workOrderId, machineId: input.machineId, notes: input.notes ?? null },
          userId,
        );
        assigned++;
        if (res.data.reassigned) moved++;
      } catch (e) {
        // Beklenmeyen hata (DB düştü, bug) YUTULMAZ — tüm çağrıyı düşürür.
        // Yalnız iş kuralı redleri satır bazında raporlanır.
        if (!(e instanceof AppError)) throw e;
        failed.push({ workOrderId, message: e.message });
      }
    }

    return {
      success: true,
      data: { assigned, moved, failed },
      message:
        failed.length === 0
          ? `${assigned} iş emri dağıtıldı`
          : `${assigned} iş emri dağıtıldı, ${failed.length} tanesi atlandı`,
    };
  }

  /**
   * ÇOK DAĞITIMI tek çağrıda iptal eder → işler havuza (bekleyen kuyruğa) döner.
   *
   * `assignBulk` ile AYNI sözleşme: her satır kendi tx'inde, sonuç parçalı
   * olabilir, atlanan her satır somut sebebiyle döner. Burada hepsi-ya-hiç
   * daha da yanlış olurdu — iptal zaten "geri al" yönüdür; bir satırın çoktan
   * tamamlanmış olması diğerlerinin havuza dönmesini engellememeli.
   */
  async cancelBulk(
    input: { assignmentIds: string[]; reason?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      cancelled: number;
      failed: Array<{ assignmentId: string; message: string }>;
    }>
  > {
    if (!userId) throw AppError.unauthorized();

    let cancelled = 0;
    const failed: Array<{ assignmentId: string; message: string }> = [];

    for (const assignmentId of input.assignmentIds) {
      try {
        await this.cancelAssignment(assignmentId, { reason: input.reason ?? null }, userId);
        cancelled++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        failed.push({ assignmentId, message: e.message });
      }
    }

    return {
      success: true,
      data: { cancelled, failed },
      message:
        failed.length === 0
          ? `${cancelled} dağıtım kaldırıldı`
          : `${cancelled} dağıtım kaldırıldı, ${failed.length} tanesi atlandı`,
    };
  }

  // ---------------------------------------------------------------------------
  // İPTAL
  // ---------------------------------------------------------------------------
  /**
   * Açık dağıtımı iptal eder → iş normal (tabletli) akışa döner.
   *
   * YALNIZ ATAMA SATIRI soft-cancel edilir; başka HİÇBİR ŞEYE dokunulmaz.
   * NEDEN: atama makine bazındadır ve adımın istasyonu (tek PROCESS_QC
   * istasyonu) atama sırasında hiç değiştirilmedi — dolayısıyla geri
   * yüklenecek bir istasyon da yok. Makine atfı yalnız FİİLEN yapılmış işin
   * izinde, yani kapanan movement'ın `machineId` damgasında tutulur; iptal
   * edilen atamada öyle bir iş hiç olmadığı için silinecek damga da yoktur.
   */
  async cancelAssignment(
    assignmentId: string,
    input: { reason?: string | null },
    userId?: string,
  ): Promise<ApiResponse<{ assignmentId: string; workOrderId: string }>> {
    const reason = input.reason?.trim() ? input.reason.trim().slice(0, 200) : null;

    const result = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM — "pending" koşulu where'de; eşzamanlı tamamlama/iptalin
      // kaybedeni 0 satır alır (findUnique→if→update YASAK).
      const claim = await tx.kursunBypassAssignment.updateMany({
        where: { id: assignmentId, completedAt: null, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason,
        },
      });
      if (claim.count === 0) {
        const existing = await tx.kursunBypassAssignment.findUnique({
          where: { id: assignmentId },
          select: { completedAt: true, cancelledAt: true },
        });
        if (!existing) throw AppError.notFound("Dağıtım kaydı bulunamadı");
        if (existing.completedAt) {
          throw AppError.conflict("Bu dağıtım tamamlanmış — iptal edilemez");
        }
        throw AppError.conflict("Bu dağıtım zaten iptal edilmiş");
      }

      // Audit gövdesi için atamanın kimliği (iptal SONRASI okunur — satır
      // append-only, claim dışında hiçbir alanı değişmiyor).
      const row = await tx.kursunBypassAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: {
          workOrderId: true,
          workOrderStepId: true,
          machineId: true,
          machine: { select: { name: true } },
        },
      });

      return {
        workOrderId: row.workOrderId,
        workOrderStepId: row.workOrderStepId,
        machineId: row.machineId,
        machineName: row.machine.name,
      };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: assignmentId,
      newData: {
        event: "KURSUN_BYPASS_UNASSIGN",
        workOrderId: result.workOrderId,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        reason,
      },
    });

    return {
      success: true,
      data: { assignmentId, workOrderId: result.workOrderId },
      message: "Dağıtım iptal edildi",
    };
  }

  // ---------------------------------------------------------------------------
  // SON ADIM: ÖNİZLEME + "İŞİ BİTİR"
  // ---------------------------------------------------------------------------
  /** Salt okunur — hiçbir şeyi değiştirmez. "İşi Bitir" onay ekranının kaynağı. */
  async getCompletePreview(
    assignmentId: string,
  ): Promise<ApiResponse<KursunBypassCompletePreview>> {
    const a = await prisma.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        workOrderId: true,
        workOrderStepId: true,
        completedAt: true,
        cancelledAt: true,
        machine: { select: { name: true, station: { select: { name: true } } } },
        workOrder: {
          select: {
            workOrderNumber: true,
            status: true,
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
    if (!a) throw AppError.notFound("Dağıtım kaydı bulunamadı");

    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    const isLastStep = next === null;

    const movements = await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: a.workOrderStepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true } },
      },
      orderBy: { enteredAt: "asc" },
    });
    const rolls: KursunBypassPreviewRoll[] = movements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      currentQty: m.roll.currentQty.toNumber(),
    }));
    const totalMeters = movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );

    let blockReason: string | null = null;
    if (a.cancelledAt) blockReason = "Bu dağıtım iptal edilmiş";
    else if (a.completedAt) blockReason = "Bu dağıtım zaten tamamlanmış";
    else if (
      a.workOrder.status === WorkOrderStatus.CANCELLED ||
      a.workOrder.status === WorkOrderStatus.SUPERSEDED
    ) {
      blockReason = "İş emri iptal/devredilmiş — tamamlanamaz";
    } else if (!isLastStep) {
      blockReason = "Kurşun son adım değil — Tambur kartı okutmasıyla tamamlanır";
    } else if (rolls.length === 0) {
      blockReason = "Adımda açık top yok — tamamlanacak iş kalmamış";
    }

    // WO bu tamamlamayla kapanır mı: kurşun adımı DIŞINDA açık adım kalmıyorsa.
    const otherOpenSteps = a.workOrder.steps.filter(
      (s) =>
        s.id !== a.workOrderStepId &&
        s.status !== StepStatus.COMPLETED &&
        s.status !== StepStatus.SKIPPED,
    ).length;

    return {
      success: true,
      data: {
        assignmentId: a.id,
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        machineName: a.machine.name,
        stationName: a.machine.station.name,
        isLastStep,
        canComplete: blockReason === null,
        blockReason,
        rollCount: rolls.length,
        totalMeters: totalMeters.toNumber(),
        rolls,
        willFinalize: {
          targetStatus: "WAREHOUSE",
          qualityStaysNull: true,
          barcodesToGenerate: rolls.filter((r) => r.barcode === null).length,
        },
        workOrderWillComplete: blockReason === null && otherOpenSteps === 0,
      },
    };
  }

  /**
   * SON ADIM yolu — kurşun rotanın son adımıysa dağıtım ekranındaki "İşi Bitir".
   * Toplar `finalizeRollsAtLastStep` ile WAREHOUSE'a çekilir (kalite NULL kalır →
   * finalize varsayılanı WAREHOUSE), barkodsuz açık kumaşa barkod üretilir.
   */
  async completeFromDistribution(
    assignmentId: string,
    input: { rollIds: string[] },
    userId?: string,
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      finalizedRollCount: number;
      barcodesGenerated: number;
    }>
  > {
    // Yinelenen id gönderimi kapsam kontrolünü (closed.length === rollIds.length)
    // yanlış negatife düşürürdü → tekilleştir.
    const rollIds = [...new Set(input.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("Tamamlanacak top seçilmedi");

    const a = await this.loadAssignmentForCompletion(assignmentId);
    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    if (next) {
      throw AppError.badRequest(
        "Kurşun son adım değil — Tambur kartı okutmasıyla tamamlanır",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await touchWorkOrderTx(tx, a.workOrderId);
      await this.assertWorkOrderAliveTx(tx, a.workOrderId);

      const claimed = await this.claimAssignmentTx(
        tx,
        assignmentId,
        a.workOrderStepId,
        userId,
        KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP,
      );
      if (!claimed) {
        return { alreadyDone: true, finalized: [] as Awaited<ReturnType<typeof finalizeRollsAtLastStep>> };
      }

      const closed = await this.closeBypassMovementsTx(
        tx,
        a.workOrderStepId,
        rollIds,
        a.machineId,
      );
      const closedRollIds = closed.map((m) => m.rollId);

      // İstasyon yetenekleri (KURSUN vb.) — bypass'ta da kopyalanır: iş fiziksel
      // olarak YAPILDI. Yetenekler ATANAN MAKİNENİN İSTASYONUNDAN okunur
      // (makinenin kendi özellik listesi yok). SIRALI (tx'te Promise.all YASAK
      // — pg tek bağlantı).
      for (const rollId of closedRollIds) {
        await copyStationCapabilitiesToRoll(tx, { stationId: a.machineStationId, rollId });
      }

      // Adım damgası (kurşun finish ile aynı gerekçe): yeniden açma yalnız KENDİ
      // girişini terslesin diye defter satırı adımını taşır.
      const finalized = await finalizeRollsAtLastStep(tx, closedRollIds, {
        workOrderStepId: a.workOrderStepId,
      });
      await recomputeStepStatus(tx, a.workOrderStepId);
      await completeWorkOrderIfStepsDone(tx, a.workOrderId, { trigger: "KURSUN_BYPASS_FINISH" });

      return { alreadyDone: false, finalized };
    });

    if (result.alreadyDone) {
      return {
        success: true,
        data: { alreadyDone: true, finalizedRollCount: 0, barcodesGenerated: 0 },
        message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
      };
    }

    const barcodesGenerated = result.finalized.filter((f) => f.barcodeGenerated).length;
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: assignmentId,
      newData: {
        event: "KURSUN_BYPASS_LAST_STEP_COMPLETE",
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        workOrderStepId: a.workOrderStepId,
        // Kapanan kurşun movement'larına damgalanan makine (RollMovement.machineId).
        machineId: a.machineId,
        machineName: a.machineName,
        stationId: a.machineStationId,
        rollIds,
        rollCount: result.finalized.length,
        barcodesGenerated,
        completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP,
      },
    });

    return {
      success: true,
      data: {
        alreadyDone: false,
        finalizedRollCount: result.finalized.length,
        barcodesGenerated,
      },
      message: `${result.finalized.length} top depoya alındı`,
    };
  }

  // ---------------------------------------------------------------------------
  // TAMBUR YOLU
  // ---------------------------------------------------------------------------
  /**
   * DAĞITILMADAN KAPANIŞIN TEK KAPISI — "bu iş emrinin kurşun adımı, atama
   * olmadan Tambur okutmasıyla kapatılabilir mi?"
   *
   * Hem okuma yolu (`findPendingForTambur` → sanal bekleyen) hem yazma yolu
   * (`completeFromTambur` → tx İÇİNDE taze doğrulama) buradan geçer. İki yerde
   * kopyalansaydı ekran "kapanabilir" derken uç reddeder (ya da tersi) duruma
   * düşerdi — sahada operatörü çıkmaza sokan sınıf.
   *
   * ÜÇ KOŞUL ve üçü de mevcut TEK KAYNAKLARDAN okunur, yeni kural yazılmaz:
   *   1. Bayrak AÇIK (`resolveKursunBypassEnabled` — üretim modülü && bayrak) — kapalıyken kurşun tableti
   *      normal dijital akışta çalışır ve onu sessizce atlamak kalite verisini
   *      hiç girilmemiş bırakırdı.
   *   2. Adım bypass'a UYGUN (`resolveBypassBlockReason` — KK2 kaydı yok, hata
   *      kaydı yok, ölçümsüz top yok, bypass dışı kapanmış hareket yok). Bu,
   *      kurşun tabletini kilitleyen yüklemin AYNISI: kilit ile kapanış aynı
   *      kaynaktan beslendiği için "tablet yazamıyor ama Tambur da kapatamıyor"
   *      çıkmazı yapısal olarak imkânsız.
   *   3. Sonraki non-SKIPPED adım gerçekten TAMBUR — `completeFromTambur`'un
   *      mevcut guard'ıyla birebir aynı koşul (kurşun SON adımsa kapanış
   *      "İşi Bitir"e aittir).
   *
   * @returns `ok` → kapatılabilir. `reason: null` → soru bu iş emri için
   *   anlamsız (bayrak kapalı / böyle bir adım yok / zaten dağıtılmış) ve
   *   çağıran sessizce çekilir. `reason` dolu → adım VAR ama kapatılamaz; yazma
   *   yolu bunu 409 olarak gösterir (sessiz ret, yanlış işlem yaptırmaktan
   *   sonra en kötüsüdür).
   */
  private async resolveUnassignedTamburClosure(
    db: PrismaClient | Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<
    | {
        ok: true;
        stepId: string;
        stationId: string;
        stationName: string;
        tamburStepId: string;
      }
    | { ok: false; reason: string | null }
  > {
    if (!(await resolveKursunBypassEnabled(db))) return { ok: false, reason: null };

    const step = await db.workOrderStep.findFirst({
      where: {
        workOrderId,
        station: { ...QUALITY_STATION_WHERE },
        movements: { some: { ...ACTIVE_MOVEMENT, exitedAt: null } },
      },
      orderBy: { stepSequence: "asc" },
      select: {
        id: true,
        status: true,
        stationId: true,
        station: { select: { name: true } },
        movements: { where: { ...ACTIVE_MOVEMENT, exitedAt: null }, select: { qtyIn: true } },
        workOrder: {
          select: {
            status: true,
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
    if (!step) return { ok: false, reason: null };

    // Dağıtılmışsa bu yol devreye GİRMEZ — atanmış akış zaten kendi dalında
    // çalışıyor. (Yazma yolunda bu kontrol yarış kapısıdır: önizleme ile onay
    // arasında planlamacı dağıtım yapmış olabilir.)
    if (await findPendingBypassAssignmentTx(db, step.id)) {
      return { ok: false, reason: null };
    }

    if (!ASSIGNABLE_WO_STATUSES.includes(step.workOrder.status)) {
      return { ok: false, reason: null };
    }

    const signals = await loadBypassEligibilitySignals(db, [step.id]);
    const blockReason = resolveBypassBlockReason(
      { id: step.id, status: step.status, movements: step.movements, workOrder: step.workOrder },
      signals,
    );
    if (blockReason) return { ok: false, reason: blockReason };

    // `resolveBypassBlockReason` kurşunun SON adım olmasını engellemez (o rota
    // meşrudur ve "İşi Bitir" ile kapanır) — ama Tambur okutmasıyla kapanamaz.
    const next = nextNonSkippedStep(step.workOrder.steps, step.id);
    if (!next || next.station.kind !== StationKind.TAMBUR) {
      return {
        ok: false,
        reason: next
          ? `Kurşundan sonraki adım Tambur değil (${next.station.name}) — kapanışı o istasyon yapamaz.`
          : "Kurşun rotanın son adımı — kapanış Kurşun Planlama ekranındaki 'İşi Bitir' ile yapılır.",
      };
    }

    return {
      ok: true,
      stepId: step.id,
      stationId: step.stationId,
      stationName: step.station.name,
      tamburStepId: next.id,
    };
  }

  /** Bir kurşun adımının AÇIK toplarını Tambur önizleme şekline çevirir. */
  private async loadTamburPendingRolls(
    stepId: string,
  ): Promise<{ rolls: KursunBypassTamburRoll[]; totalMeters: number }> {
    const movements = await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: stepId, exitedAt: null },
      select: {
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            parentReceipt: { select: { receiptNo: true } },
            color: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { enteredAt: "asc" },
    });

    const totalMeters = movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );

    return {
      rolls: movements.map((m) => ({
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        currentQty: m.roll.currentQty.toNumber(),
        receiptNo: m.roll.parentReceipt?.receiptNo ?? null,
        colorCode: m.roll.color?.code ?? null,
        colorName: m.roll.color?.name ?? null,
      })),
      totalMeters: totalMeters.toNumber(),
    };
  }

  /**
   * "Tambur'da kartı okuttum, 'bu adımda açık top yok' dedi — NEDEN?"
   *
   * `assertWoAtStepKind`'in genel 400'ü *"Tabletinizi yanlış istasyonda okutmuş
   * olabilirsiniz"* diyor; oysa mal kurşunda beklerken operatör TAM DOĞRU
   * istasyonda duruyor ve mesaj onu yanlış yere bakmaya gönderiyor. Bu metot,
   * o cümlenin sonuna eklenecek somut sebebi üretir.
   *
   * `null` = eklenecek bir şey yok (mal kurşunda beklemiyor) → mesaj aynen kalır.
   */
  async explainTamburScanBlock(workOrderId: string): Promise<string | null> {
    const target = await this.resolveUnassignedTamburClosure(prisma, workOrderId);
    // Kapatılabilir durumda buraya hiç gelinmez (çağıran o dala girer); gelinirse
    // eklenecek bir "engel" de yoktur.
    if (target.ok) return null;
    if (target.reason) return target.reason;

    const step = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId,
        station: { ...QUALITY_STATION_WHERE },
        movements: { some: { ...ACTIVE_MOVEMENT, exitedAt: null } },
      },
      orderBy: { stepSequence: "asc" },
      select: { id: true, station: { select: { name: true } } },
    });
    if (!step) return null;

    if (await findPendingBypassAssignmentTx(prisma, step.id)) {
      return `Toplar "${step.station.name}" adımında ve iş bir kurşun makinesine dağıtılmış — kapanış için Kurşun Planlama ekranını kontrol edin.`;
    }
    return `Toplar "${step.station.name}" adımında bekliyor — kapanış kurşun tabletinden yapılır.`;
  }

  /**
   * Tambur ekranının okuma ucu — `tambur.service` bunu çağırır (ters yönde import
   * YOK). null = bu iş emrinde Tambur'da kapatılacak kurşun işi yok (normal akış).
   *
   * İKİ KAYNAK (2026-08-06): açık ATAMA varsa `source: "ASSIGNED"`; yoksa ve adım
   * dağıtımsız kapanışa uygunsa `source: "UNASSIGNED"` ile SANAL bekleyen üretilir
   * — dağıtım fabrikada kritik bir adım değil ve unutulduğunda mal Tambur'un
   * önünde kilitleniyordu.
   */
  async findPendingForTambur(
    workOrderId: string,
  ): Promise<KursunBypassTamburContext | null> {
    const a = await prisma.kursunBypassAssignment.findFirst({
      where: { workOrderId, completedAt: null, cancelledAt: null },
      select: {
        id: true,
        workOrderStepId: true,
        machineId: true,
        assignedAt: true,
        notes: true,
        machine: {
          select: { name: true, stationId: true, station: { select: { name: true } } },
        },
        assignedBy: { select: { fullName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!a) {
      const target = await this.resolveUnassignedTamburClosure(prisma, workOrderId);
      if (!target.ok) return null;
      const { rolls, totalMeters } = await this.loadTamburPendingRolls(target.stepId);
      return {
        assignmentId: null,
        source: "UNASSIGNED",
        stepId: target.stepId,
        // Atıf UYDURULMAZ: işi hangi kurşun makinesinin yaptığı bilinmiyor.
        machineId: null,
        machineName: null,
        stationId: target.stationId,
        stationName: target.stationName,
        assignedAt: null,
        assignedByName: null,
        notes: null,
        rollCount: rolls.length,
        totalMeters,
        rolls,
      };
    }

    const { rolls, totalMeters } = await this.loadTamburPendingRolls(a.workOrderStepId);

    return {
      assignmentId: a.id,
      source: "ASSIGNED",
      stepId: a.workOrderStepId,
      machineId: a.machineId,
      machineName: a.machine.name,
      stationId: a.machine.stationId,
      stationName: a.machine.station.name,
      assignedAt: a.assignedAt,
      assignedByName: a.assignedBy?.fullName ?? null,
      notes: a.notes,
      rollCount: rolls.length,
      totalMeters,
      rolls,
    };
  }

  /**
   * TAMBUR yolu — operatör refakat kartının karekodunu okutur, önizlemeyi onaylar:
   * Kurşun/KK2 adımı COMPLETED sayılır ve toplar Tambur adımına geçer.
   *
   * KALİTEYE DOKUNULMAZ (null kalır) — kaliteyi Tambur belirler. `RollOperation`
   * yazılmaz, `RollError` açılmaz (bypass tanımı).
   */
  async completeFromTambur(
    input: { cardBarcode: string; rollIds: string[] },
    userId?: string,
    machineId?: string | null,
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      movedRollCount: number;
      tamburStepId: string | null;
      workOrderId: string;
    }>
  > {
    const rollIds = [...new Set(input.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("Tamamlanacak top seçilmedi");

    // ── Ön kontroller (tx dışı) ────────────────────────────────────────────
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: normalizeScanCode(input.cardBarcode) },
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${input.cardBarcode}`);
    }
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
    }

    const pending = await prisma.kursunBypassAssignment.findFirst({
      where: { workOrderId: card.workOrderId, completedAt: null, cancelledAt: null },
      select: { id: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!pending) {
      // DAĞITILMADAN KAPANIŞ (2026-08-06). Dağıtım fabrikada kritik bir adım
      // değil ve unutuluyor; bayrak açıkken kurşun tableti de salt-okunur olduğu
      // için iş iki taraftan kilitleniyordu. Adım bypass'a UYGUNSA (aynı yüklem)
      // kapanışı Tambur okutması yapar — makine atfı olmadan.
      const target = await this.resolveUnassignedTamburClosure(prisma, card.workOrderId);
      if (target.ok) {
        return await this.completeUnassignedFromTambur(
          { cardBarcode: input.cardBarcode, rollIds },
          card.workOrderId,
          target,
          userId,
          machineId,
        );
      }
      // Adım VAR ama kapatılamıyor → sessiz 404 yerine somut sebep. (Pratikte
      // yarış: önizleme ile onay arasında tablette KK2 yazılmış olabilir.)
      if (target.reason) throw AppError.conflict(target.reason);

      // İDEMPOTENT TEKRAR. Tambur tabletinin isteği commit oldu ama yanıt
      // istemciye ulaşmadıysa (ağ kesintisi / offline kuyruk replay'i) operatör
      // AYNI okutmayı tekrar gönderir. O noktada açık atama YOKTUR — bu dal
      // olmadan kullanıcı, işi kendisi bitirmiş olmasına rağmen "bekleyen
      // dağıtım yok" 404'ü görür ve ekranda ne yapacağını bilemez.
      // `completeFromDistribution` bu davranışı zaten taşıyor (assignmentId ile
      // çağrıldığı için tamamlanmış satırı bulup `alreadyDone` dönüyor); Tambur
      // yolu atamayı KART üzerinden çözdüğü için aynı sonucu burada üretiyoruz.
      const done = await this.findCompletedTamburBypass(card.workOrderId);
      if (done) {
        return {
          success: true,
          data: {
            alreadyDone: true,
            movedRollCount: 0,
            tamburStepId: done.tamburStepId,
            workOrderId: card.workOrderId,
          },
          message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
        };
      }
      // Dağıtılmadan kapanmış işin atama satırı YOKTUR — idempotent tekrarın izi
      // movement marker'ıdır. Bu dal olmadan replay 404 alır ve operatör kendi
      // bitirdiği işi "yok" diye görürdü.
      const doneUnassigned = await this.findCompletedUnassignedClosure(card.workOrderId);
      if (doneUnassigned) {
        return {
          success: true,
          data: {
            alreadyDone: true,
            movedRollCount: 0,
            tamburStepId: doneUnassigned.tamburStepId,
            workOrderId: card.workOrderId,
          },
          message: "Kurşun adımı zaten kapatılmış (idempotent tekrar)",
        };
      }
      throw AppError.notFound("Bu iş emrinde bekleyen kurşun dağıtımı yok");
    }

    const a = await this.loadAssignmentForCompletion(pending.id);
    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    // Rota atama sonrası değişmiş olabilir (adım eklendi / SKIPPED kaldırıldı).
    if (!next || next.station.kind !== StationKind.TAMBUR) {
      throw AppError.conflict(
        next
          ? `Kurşundan sonraki adım Tambur değil (${next.station.name}) — rota dağıtımdan sonra değişmiş. Dağıtımı iptal edin.`
          : "Kurşun rotanın son adımı — Tambur okutmasıyla değil, Kurşun Dağıtım ekranındaki 'İşi Bitir' ile tamamlanır.",
      );
    }
    const tamburStep = next;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await touchWorkOrderTx(tx, a.workOrderId);
        await this.assertWorkOrderAliveTx(tx, a.workOrderId);

        const claimed = await this.claimAssignmentTx(
          tx,
          a.assignmentId,
          a.workOrderStepId,
          userId,
          KursunBypassCompletionSource.TAMBUR_SCAN,
        );
        if (!claimed) return { alreadyDone: true, moved: 0 };

        const closed = await this.closeBypassMovementsTx(
          tx,
          a.workOrderStepId,
          rollIds,
          a.machineId,
        );
        const closedRollIds = closed.map((m) => m.rollId);

        // İstasyon yetenekleri (KURSUN) — iş fiziksel olarak yapıldı; yetenekler
        // ATANAN MAKİNENİN İSTASYONUNDAN okunur. SIRALI.
        for (const rollId of closedRollIds) {
          await copyStationCapabilitiesToRoll(tx, {
            stationId: a.machineStationId,
            rollId,
          });
        }

        // Tambur adımına GİRİŞ movement'ları. `machineId` BURADA BİLİNÇLİ olarak
        // yazılmaz — kurşun makinesi damgası KAPANAN kurşun movement'ına konur;
        // AÇILAN Tambur girişinin makine damgası Tambur FINISH'inde konacaktır
        // (kursun-qc.finishStep ile aynı sözleşme). Buraya kurşun makinesini
        // yazmak "bu top Tambur'da şu kurşun makinesinde işlendi" yalanı olurdu.
        // Çift açılışa karşı DB seddi partial unique
        // `roll_movements_one_open_per_roll_step_uq`.
        await tx.rollMovement.createMany({
          data: closed.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: tamburStep.id,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn ?? null,
            operatorId: userId ?? null,
            notes: null,
          })),
        });
        // KALİTEYE DOKUNMA — qualityGrade null kalır, Tambur belirler.
        await tx.roll.updateMany({
          where: { id: { in: closedRollIds } },
          data: { currentStepId: tamburStep.id },
        });

        await recomputeStepStatus(tx, tamburStep.id);
        await recomputeStepStatus(tx, a.workOrderStepId);

        return { alreadyDone: false, moved: closedRollIds.length };
      });
    } catch (err) {
      if (p2002Mentions(err, /one_open_per_roll_step/i)) {
        throw AppError.conflict(
          "Toplar bu sırada Tambur'a taşınmış — ekranı yenileyin.",
        );
      }
      throw err;
    }

    if (result.alreadyDone) {
      return {
        success: true,
        data: {
          alreadyDone: true,
          movedRollCount: 0,
          tamburStepId: tamburStep.id,
          workOrderId: a.workOrderId,
        },
        message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
      };
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: a.assignmentId,
      newData: {
        event: "KURSUN_BYPASS_TAMBUR_COMPLETE",
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        workOrderStepId: a.workOrderStepId,
        tamburStepId: tamburStep.id,
        // ATANAN kurşun makinesi — kapanan kurşun movement'larına damgalanan
        // makine budur (dağıtımı yapan kişi makineyi seçti, atıf BİLİNİYOR).
        machineId: a.machineId,
        machineName: a.machineName,
        stationId: a.machineStationId,
        cardBarcode: input.cardBarcode,
        rollIds,
        rollCount: result.moved,
        // Okutmanın yapıldığı TAMBUR cihazının makinesi — kurşun makinesiyle
        // karıştırılmasın diye ayrı alanda, yalnız denetim izi olarak durur.
        scannedOnMachineId: machineId ?? null,
        completedVia: KursunBypassCompletionSource.TAMBUR_SCAN,
      },
    });

    return {
      success: true,
      data: {
        alreadyDone: false,
        movedRollCount: result.moved,
        tamburStepId: tamburStep.id,
        workOrderId: a.workOrderId,
      },
      message: `Kurşun adımı tamamlandı, ${result.moved} top Tambur'a alındı`,
    };
  }

  /**
   * DAĞITILMADAN KAPANIŞ — atama satırı olmadan kurşun adımını Tambur
   * okutmasıyla kapatır. `completeFromTambur`'un ikinci dalı; atanmış yolla
   * AYNI mekaniği kullanır, iki noktada bilinçli olarak ayrılır:
   *
   *   • `machineId = null` — işi hangi kurşun makinesinin yaptığı BİLİNMİYOR.
   *     Varsayılan bir makineye yazmak makine bazlı hacim raporunu sistematik
   *     olarak yanlışlardı (ürün kararı); boşluk dürüsttür ve sayaçla görünür.
   *   • Yetenekler adımın KENDİ istasyonundan kopyalanır (atanmış yolda
   *     makinenin istasyonundan) — fabrikada tek PROCESS_QC istasyonu olduğu
   *     için sonuç aynı satırdır.
   *
   * ⚠️ ATOMİK CLAIM'e gerek YOK ve bilinçli olarak eklenmedi: claim'in işini
   * `closeBypassMovementsTx` zaten yapıyor (`exitedAt IS NULL` guard'ı + kapsam
   * paritesi). İki eşzamanlı okutmada biri kapatır, diğeri 409 alır; mobil zaten
   * kapsamı tazeleyip bir kez yeniden dener ve o turda kart normal yolla açılır.
   */
  private async completeUnassignedFromTambur(
    input: { cardBarcode: string; rollIds: string[] },
    workOrderId: string,
    target: { stepId: string; stationId: string; tamburStepId: string },
    userId?: string,
    scannedOnMachineId?: string | null,
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      movedRollCount: number;
      tamburStepId: string | null;
      workOrderId: string;
    }>
  > {
    const { rollIds } = input;
    let moved: number;
    try {
      moved = await prisma.$transaction(async (tx) => {
        await touchWorkOrderTx(tx, workOrderId);
        await this.assertWorkOrderAliveTx(tx, workOrderId);

        // ⚠️ TAZE DOĞRULAMA — tx DIŞINDAKİ ön kontrolün TOCTOU ikizi. Ön kontrol
        // ile bu tx arasında planlamacı dağıtım yapmış ya da kurşun tableti
        // (offline kuyruktan gelen bir istekle) KK2 yazmış olabilir; iki rejimin
        // aynı adıma yazması tam da bu pencerede doğar. Fail-closed: yarım
        // kapanış bırakmaktansa hiç kapatma.
        //
        // ⚠️ BEKÇİ ERİŞEMEZ: bu dal ancak GERÇEK bir eşzamanlılıkta tetiklenir —
        // tek iş parçacıklı testte ön kontrol her zaman önce reddeder (ölçüldü:
        // bu blok körleştirilince test 50/50 yeşil kalıyor). Yani burası derinlik
        // savunmasıdır; silmeden önce yerine ne koyduğunu bil. Testin ölçtüğü
        // eşzamanlılık özelliği ayrıdır: N paralel okutmadan yalnız biri kapatır
        // (`closeBypassMovementsTx`'in `exitedAt IS NULL` claim'i).
        const fresh = await this.resolveUnassignedTamburClosure(tx, workOrderId);
        if (
          !fresh.ok ||
          fresh.stepId !== target.stepId ||
          fresh.tamburStepId !== target.tamburStepId
        ) {
          throw AppError.conflict(
            !fresh.ok && fresh.reason
              ? `Kurşun adımı bu sırada değişti: ${fresh.reason} Ekranı yenileyin.`
              : "Kurşun adımı bu sırada değişti (dağıtıldı ya da başka yoldan kapandı) — ekranı yenileyin.",
          );
        }

        const closed = await this.closeBypassMovementsTx(
          tx,
          fresh.stepId,
          rollIds,
          null,
          KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX,
        );
        const closedRollIds = closed.map((m) => m.rollId);

        // İstasyon yetenekleri (KURSUN) — iş fiziksel olarak yapıldı. SIRALI.
        for (const rollId of closedRollIds) {
          await copyStationCapabilitiesToRoll(tx, {
            stationId: fresh.stationId,
            rollId,
          });
        }

        // Tambur adımına GİRİŞ movement'ları — atanmış yolla birebir aynı
        // sözleşme (`machineId` burada yazılmaz, Tambur FINISH'inde konur).
        await tx.rollMovement.createMany({
          data: closed.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: fresh.tamburStepId,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn ?? null,
            operatorId: userId ?? null,
            notes: null,
          })),
        });
        // KALİTEYE DOKUNMA — qualityGrade null kalır, Tambur belirler.
        await tx.roll.updateMany({
          where: { id: { in: closedRollIds } },
          data: { currentStepId: fresh.tamburStepId },
        });

        await recomputeStepStatus(tx, fresh.tamburStepId);
        await recomputeStepStatus(tx, fresh.stepId);

        return closedRollIds.length;
      });
    } catch (err) {
      if (p2002Mentions(err, /one_open_per_roll_step/i)) {
        throw AppError.conflict(
          "Toplar bu sırada Tambur'a taşınmış — ekranı yenileyin.",
        );
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      // Gösterilecek atama satırı YOK — iz adımın kendisine bağlanır.
      tableName: "WORK_ORDER_STEP",
      recordId: target.stepId,
      newData: {
        event: "KURSUN_BYPASS_TAMBUR_COMPLETE_UNASSIGNED",
        workOrderId,
        workOrderStepId: target.stepId,
        tamburStepId: target.tamburStepId,
        stationId: target.stationId,
        // AÇIKÇA null: "bilinmiyor" ile "yazılmamış" denetimde ayırt edilebilsin.
        machineId: null,
        cardBarcode: input.cardBarcode,
        rollIds,
        rollCount: moved,
        scannedOnMachineId: scannedOnMachineId ?? null,
      },
    });

    return {
      success: true,
      data: {
        alreadyDone: false,
        movedRollCount: moved,
        tamburStepId: target.tamburStepId,
        workOrderId,
      },
      message: `Kurşun adımı dağıtımsız kapatıldı, ${moved} top Tambur'a alındı`,
    };
  }

  // ---------------------------------------------------------------------------
  // ORTAK ÖZEL YARDIMCILAR
  // ---------------------------------------------------------------------------

  /**
   * "Bu iş emrinin Tambur bypass'ı ZATEN tamamlandı mı?" — idempotent tekrar
   * dalının kaynağı (salt okunur).
   *
   * `null` döner (yani çağıran 404 atar) iki halde:
   *  • WO'da hiç TAMBUR_SCAN ile tamamlanmış atama yok → gerçekten dağıtım yok.
   *  • Adımda YENİDEN açık top var (çok-parti 2. turu geldi ama daha dağıtılmadı)
   *    → bekleyen İŞ var ama bekleyen DAĞITIM yok; "zaten bitti" demek yanlış
   *    olurdu, operatör 2. partiyi sessizce yok sayılmış sanırdı.
   */
  private async findCompletedTamburBypass(
    workOrderId: string,
  ): Promise<{ tamburStepId: string | null } | null> {
    const done = await prisma.kursunBypassAssignment.findFirst({
      where: {
        workOrderId,
        completedAt: { not: null },
        completedVia: KursunBypassCompletionSource.TAMBUR_SCAN,
      },
      orderBy: { completedAt: "desc" },
      select: {
        workOrderStepId: true,
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
    if (!done) return null;

    const stillOpen = await prisma.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: done.workOrderStepId, exitedAt: null },
    });
    if (stillOpen > 0) return null;

    const next = nextNonSkippedStep(done.workOrder.steps, done.workOrderStepId);
    return {
      tamburStepId:
        next && next.station.kind === StationKind.TAMBUR ? next.id : null,
    };
  }

  /**
   * `findCompletedTamburBypass`'in DAĞITILMADAN kapanış kardeşi.
   *
   * O yol atama satırına bakar; burada atama satırı YOKTUR, kapanışın izi
   * `RollMovement.notes` marker'ıdır. Bu dal olmadan offline replay / ağ
   * kesintisi sonrası tekrar 404 alır ve operatör kendi bitirdiği işi "yok"
   * diye görürdü.
   *
   * `null` döner: hiç dağıtımsız kapanış yok, ya da adımda YENİDEN açık top var
   * (çok-parti 2. turu) — ikincisinde "zaten bitti" demek yanlış olurdu.
   */
  private async findCompletedUnassignedClosure(
    workOrderId: string,
  ): Promise<{ tamburStepId: string | null } | null> {
    const step = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId,
        station: { ...QUALITY_STATION_WHERE },
        movements: {
          some: {
            ...ACTIVE_MOVEMENT,
            exitedAt: { not: null },
            notes: { startsWith: KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX },
          },
        },
      },
      orderBy: { stepSequence: "asc" },
      select: {
        id: true,
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
    if (!step) return null;

    const stillOpen = await prisma.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: step.id, exitedAt: null },
    });
    if (stillOpen > 0) return null;

    const next = nextNonSkippedStep(step.workOrder.steps, step.id);
    return {
      tamburStepId:
        next && next.station.kind === StationKind.TAMBUR ? next.id : null,
    };
  }

  /**
   * Tamamlama yollarının ortak ön-yüklemesi (atama + MAKİNE + adım + WO rotası).
   *
   * Düzleştirilmiş `machineStationId`/`machineName` alanları çağıranların iki
   * ihtiyacını karşılar: yetenek kopyalaması makinenin İSTASYONUNU ister
   * (`copyStationCapabilitiesToRoll`), movement damgası ise MAKİNENİN kendisini.
   */
  private async loadAssignmentForCompletion(assignmentId: string) {
    const a = await prisma.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        workOrderId: true,
        workOrderStepId: true,
        machineId: true,
        machine: { select: { name: true, stationId: true } },
        completedAt: true,
        cancelledAt: true,
        workOrder: {
          select: {
            workOrderNumber: true,
            status: true,
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
    if (!a) throw AppError.notFound("Dağıtım kaydı bulunamadı");
    if (a.cancelledAt) throw AppError.conflict("Bu dağıtım iptal edilmiş");
    return {
      ...a,
      assignmentId: a.id,
      machineName: a.machine.name,
      machineStationId: a.machine.stationId,
    };
  }

  /**
   * WO ÖLÜ MÜ? (kilit altında taze okuma). İptal/devredilmiş iş emrinin topu
   * finalize/ilerletme kabul etmez — Tambur finalize guard'ıyla aynı gerekçe:
   * kartlar VOIDED, top "canlı ama kimsenin okutamadığı" çıkmaza düşerdi.
   */
  private async assertWorkOrderAliveTx(
    tx: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<void> {
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        "İptal/devredilmiş iş emrinde kurşun dağıtımı tamamlanamaz — dağıtımı iptal edin.",
      );
    }
  }

  /**
   * Atamayı ATOMİK CLAIM ile "tamamlandı" damgalar.
   *  • true  → claim BİZE düştü, kapatmaya devam.
   *  • false → idempotent tekrar (zaten tamamlanmış VE adımda açık top yok).
   *  • throw → gerçek çakışma (iptal edilmiş / hâlâ açık top varken tamamlanmış).
   */
  private async claimAssignmentTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    stepId: string,
    userId: string | undefined,
    via: KursunBypassCompletionSource,
  ): Promise<boolean> {
    const claim = await tx.kursunBypassAssignment.updateMany({
      where: { id: assignmentId, completedAt: null, cancelledAt: null },
      data: {
        completedAt: new Date(),
        completedById: userId ?? null,
        completedVia: via,
      },
    });
    if (claim.count > 0) return true;

    const fresh = await tx.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: { completedAt: true, cancelledAt: true },
    });
    if (!fresh) throw AppError.notFound("Dağıtım kaydı bulunamadı");
    if (fresh.cancelledAt) {
      throw AppError.conflict("Bu dağıtım iptal edilmiş — tamamlanamaz");
    }
    // Zaten tamamlanmış: adımda açık top KALMADIYSA işi gerçekten biten bir
    // tekrar isteğidir (offline resume / çift dokunuş) → idempotent başarı.
    const stillOpen = await tx.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: stepId, exitedAt: null },
    });
    if (stillOpen === 0) return false;
    throw AppError.conflict(
      "Bu dağıtım az önce tamamlandı ama adımda hâlâ açık top var — ekranı yenileyin.",
    );
  }

  /**
   * Adımın açık movement'larını BYPASS marker'ıyla kapatır ve kapatılan satırları
   * döner (finishStep şablonuyla birebir mekanik).
   *
   * • `qtyOut = qtyIn` / `weightOut = weightIn`: istasyona giren metraj olduğu
   *   gibi çıktı — bypass'ta kesim/fire kararı YOK.
   * • `exitedAt IS NULL` guard'ı: movement seti tx DIŞINDA seçildiği için bu
   *   koşul olmasa iki eşzamanlı istek aynı satırları kapatıp topu sonraki adıma
   *   İKİ kez ilerletirdi. Guard ile her satır tek tx'e düşer.
   * • `revokedAt IS NULL`: geri alınmış hareket hiç olmamış sayılır; kapatılmaz,
   *   makine damgası ve marker almaz (`ACTIVE_MOVEMENT`ın ham SQL ikizi).
   * • `rollId = ANY(...)`: kapsam DARALTMASI — önizleme ile onay arasında adıma
   *   yeni top girmişse (fason kabul / önceki adım FINISH) o top süpürülmez.
   * • Marker uuid'si UYGULAMADA üretilir: `gen_random_uuid()` VOLATILE olup
   *   çok-satırlı UPDATE'te SATIR BAŞINA farklı değer üretir ve "tur" kimliğini
   *   bozardı (F161 dersi).
   * • `machineId` = ATANAN MAKİNE. Atama makine bazında yapıldığı için işi
   *   hangi fiziksel kurşun makinesinin yaptığı BİLİNİYOR — dağıtımı yapan kişi
   *   onu seçti. Damga bu yüzden konur; makine bazlı hacim raporları (kurşun
   *   makinesi başına metraj) bu sayede bypass işlerini de görür. Koşulsuz
   *   yazılır: satır zaten `exitedAt IS NULL` olduğundan bu tur bu adımda
   *   makine damgası koyan İLK ve TEK yazımdır.
   *   ⚠️ DAĞITILMADAN kapanışta `null` gelir — atıf bilinmiyor ve uydurulmaz;
   *   o iş makine bazlı raporda görünmez ve bu bilinçlidir (sayaçla izlenir).
   *
   * @param markerPrefix Kapanışın kaynağını `RollMovement.notes`'a yazan ön ek.
   *   İki değer de `KURSUN_BYPASS_MARKER_PREFIX` ile BAŞLAR — okuyan yerler
   *   (`hasBypassClosureOnQualityStepTx`, `loadBypassEligibilitySignals`) satırı
   *   `startsWith` ile tanıyor; kopması sessiz regresyon üretirdi.
   */
  private async closeBypassMovementsTx(
    tx: Prisma.TransactionClient,
    stepId: string,
    rollIds: string[],
    machineId: string | null,
    markerPrefix: string = KURSUN_BYPASS_MARKER_PREFIX,
  ): Promise<
    Array<{ rollId: string; qtyIn: Prisma.Decimal; weightIn: Prisma.Decimal | null }>
  > {
    const marker = `${markerPrefix}:${randomUUID()}`;
    const closed = await tx.$queryRaw<
      Array<{ rollId: string; qtyIn: Prisma.Decimal; weightIn: Prisma.Decimal | null }>
    >`
      UPDATE "roll_movements"
      SET "qtyOut" = "qtyIn",
          "weightOut" = "weightIn",
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          "exitedAt" = now(),
          "machineId" = ${machineId}::uuid,
          "notes" = ${marker}
      WHERE "workOrderStepId" = ${stepId}::uuid
        AND "exitedAt" IS NULL
        AND "revokedAt" IS NULL
        AND "rollId" = ANY(${rollIds}::uuid[])
      RETURNING "rollId", "qtyIn", "weightIn"
    `;

    // KAPSAM PARİTESİ: istenen her top gerçekten kapatılmalı. Eksikse sessizce
    // daha az iş yapma (yıkıcı-onay ilkesi) — operatör önizlemeyi yenilesin.
    if (closed.length !== rollIds.length) {
      throw AppError.conflict(
        `Seçilen ${rollIds.length} topun ${closed.length} tanesi kapatılabildi — toplar bu sırada değişmiş. Önizlemeyi yenileyin.`,
      );
    }
    // Adımda BAŞKA açık top kaldıysa adım COMPLETED olamaz; yarım kapanış
    // bırakmak yerine tümünü geri al ve operatöre yeni durumu göster.
    const leftover = await tx.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: stepId, exitedAt: null },
    });
    if (leftover > 0) {
      throw AppError.conflict(
        `Adıma bu sırada yeni top girdi (${leftover} adet) — önizlemeyi yenileyin.`,
      );
    }
    return closed;
  }
}
