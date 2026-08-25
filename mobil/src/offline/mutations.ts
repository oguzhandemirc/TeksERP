// İstasyon mutation registry.
//
// PersistQueryClientProvider mutation'ın FN referansını persist edemez (sadece
// variables ve state). App restart sonrasında paused mutation FN'ini bulamazsa
// resume çalışmaz. Çözüm: mutationFn'leri global setMutationDefaults ile
// mutationKey'e bağla; component'ler sadece mutationKey kullansın.
//
// Persist kapsamı App.tsx'te persistPolicy.shouldPersistMutation ile genişletildi:
// paused ∪ pending-istasyon (aktif retry'daki kayıt app kill'de kaybolmasın).
//
// AUTH GUARD (veri kaybı önleme): logout tavana takılıp token silindiğinde
// kuyruktaki kayıt HTTP'ye çıkarsa 401 alır ve 4xx fail-fast kuralıyla KALICI
// düşerdi. withAuthGuard token yokken isteği HİÇ atmaz — NoAuthError fırlatır;
// retry politikası bu hatayı süresiz, 15sn arayla yeniden dener (sunucuya yük
// sıfır). Giriş yapılınca ilk denemede akar (sessionSwitch.nudgeOutbox hızlandırır).

import { queryClient } from './queryClient';
import { jitteredBackoff } from './backoff';
import { resolveAuthToken } from '../services/api';
import { useAuthStore } from '../store/authStore';
import {
  kursunQcService,
  type CompleteQc2Request,
  type ReportErrorRequest,
  type DeleteErrorRequest,
  type FinishStepRequest,
} from '../services/kursunQc.service';
import { rollService, type InitialEntryRequest } from '../services/roll.service';
import { tamburService } from '../services/tambur.service';
import {
  subcontractorService,
  type DispatchRequest,
} from '../services/subcontractor.service';
import {
  kartelaService,
  type KartelaDispatchRequest,
  type KartelaReceiveRequest,
} from '../services/kartela.service';
import type {
  TamburFinalizeRemainingAction,
  ReceiveRequest,
} from '../types/models';

export const STATION_MUT = {
  QC2_COMPLETE: ['station', 'qc2-complete'] as const,
  QC2_REPORT_ERROR: ['station', 'qc2-report-error'] as const,
  QC2_DELETE_ERROR: ['station', 'qc2-delete-error'] as const,
  QC2_FINISH_STEP: ['station', 'qc2-finish-step'] as const,
  KURSUN_FINISH: ['station', 'kursun-finish'] as const,
  TAMBUR_FINALIZE_OPEN_FABRIC: ['station', 'tambur-finalize-open-fabric'] as const,
  KK1_CREATE_ENTRY: ['station', 'kk1-create-entry'] as const,
  KK1_SCRAP: ['station', 'kk1-scrap'] as const,
  FASON_KABUL_RECEIVE: ['station', 'fason-kabul-receive'] as const,
  FASON_SEVK_DISPATCH: ['station', 'fason-sevk-dispatch'] as const,
  KARTELA_SEVK_DISPATCH: ['station', 'kartela-sevk-dispatch'] as const,
  KARTELA_KABUL_RECEIVE: ['station', 'kartela-kabul-receive'] as const,
} as const;

/**
 * İstasyon kaydının operatöre GÖRÜNEN adı — ölü mektup kutusu satırları bunu
 * basar ("Ham Giriş · 3 dk önce · Bu top az önce girilmiş olabilir").
 * `STATION_MUT` ile aynı dosyada durur ki yeni bir anahtar eklerken etiket
 * unutulmasın (bekçi: `mutations.test.ts` — her anahtarın etiketi olmalı).
 */
// Tanımlar `stationLabels.ts`e taşındı (queryClient ↔ mutations içe aktarma
// döngüsünü kırmak için); çağrı yerleri değişmesin diye buradan re-export edilir.
export { STATION_MUT_LABELS, stationOpLabel } from './stationLabels';

export interface TamburFinalizeOpenFabricVars {
  rollId: string;
  remainingAction: TamburFinalizeRemainingAction;
  foldType: string | null;
  /**
   * SAPMA SEBEBİ (2026-08-09) — yalnız `scrap`/`discard` kararında anlamlı.
   * ⚠️ Bu tip OFFLINE KUYRUĞA serileşiyor: alan eklendiği için eski kuyrukta
   * bekleyen kayıtlarda `undefined` gelir ve backend onu "BELIRTILMEDI" ile
   * yazar (kabul edilir, reddedilmez). Alanı ZORUNLU yapma — bekleyen kuyruk
   * flush edilirken toplu 400 üretirdi.
   */
  varianceReasonCode?: string | null;
  varianceReasonText?: string | null;
  /** Plan-gerçek sapma onayı (renk/en). Eski kuyruk kayıtlarında `undefined`
   *  gelir — sapma yoksa backend zaten bakmaz; sapma varsa replay 409'a düşer
   *  ve kalıcı-düşüş toast'ı sebebi söyler (kayıt yazılmadı, mal ekranda). */
  confirmMismatch?: boolean;
}

/** NoAuth bekleme aralığı — token gelene dek sunucusuz "yokla" periyodu. */
export const NO_AUTH_RETRY_MS = 15_000;

/** Token yokken fırlatılır — HTTP'ye hiç çıkılmadığı için sunucu yükü sıfır;
 *  retry politikası bunu süresiz bekletir (kayıt kaybolmaz). */
export class NoAuthError extends Error {
  readonly noAuth = true;
  constructor() {
    super('Oturum yok — kayıt girişten sonra gönderilecek');
    this.name = 'NoAuthError';
  }
}

export function isNoAuthError(error: unknown): boolean {
  return !!(error as { noAuth?: boolean } | null)?.noAuth;
}

/** mutationFn sarmalayıcısı: token yoksa isteği HİÇ atma (guard HTTP öncesi). */
const withAuthGuard =
  <V, R>(fn: (vars: V) => Promise<R>) =>
  async (vars: V): Promise<R> => {
    if (!(await resolveAuthToken())) throw new NoAuthError();
    return fn(vars);
  };

// Y12 fix: 401 retry edilmez — ilk 401 token'ı sildiğinden kalan denemeler de
// 401 alıyordu; 3 deneme boyunca dönmek hem kuyruğu oyalıyor hem hata anını
// geciktiriyordu. 401'de hemen düş; operatör yeniden girişten sonra kaydı
// tekrar gönderir (api.ts artık 'oturum doldu' toast'ı gösteriyor).
// L fix (Y12 genislemesi): TUM deterministik 4xx fail-fast — 400/403/404/409
// yeniden denenince ayni cevabi alir, hata toastini ~8sn geciktirirdi.
// NoAuthError İSTİSNA: HTTP'ye çıkmamış kayıt kalıcı düşürülmez, süresiz bekler.
// 401 + bellekte token YOK da aynı istisnadır: guard'ı token'la geçmiş ama
// uçuş sırasında logout olmuş istek sunucudan 401 alır — bu "oturum yok"
// beklemesidir, kalıcı düşürme değil (api.ts toast'ı zaten 'girişten sonra
// gönderilir' diyor; sözü kod da tutsun). Token bellekte DURUYORKEN gelen 401
// (kick/iptal) eski Y12 kuralıyla fail-fast kalır.
export const stationRetry = (failureCount: number, error: unknown): boolean => {
  if (isNoAuthError(error)) return true;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 && !useAuthStore.getState().token) return true;
  if (status && status >= 400 && status < 500) return false;
  return failureCount < 3;
};

/** NoAuth (ve token'sız 401): sabit 15sn — istek ağa çıkmıyor/çıkamayacak,
 *  jitter gereksiz. Diğerleri: ±%30 jitter'lı üstel backoff (vardiya başı
 *  senkron retry dalgasını kırar). */
export const stationRetryDelay = (attempt: number, error: unknown): number => {
  if (isNoAuthError(error)) return NO_AUTH_RETRY_MS;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 && !useAuthStore.getState().token) return NO_AUTH_RETRY_MS;
  return jitteredBackoff(attempt);
};

const OFFLINE_AWARE = {
  networkMode: 'online' as const,
  retry: stationRetry,
  retryDelay: stationRetryDelay,
};

export function registerStationMutationDefaults(): void {
  // queryClient default 'always' — burada explicit'ten 'online'a override:
  // offline'da pause + AsyncStorage persist + online resume.
  queryClient.setMutationDefaults(STATION_MUT.QC2_COMPLETE, {
    mutationFn: withAuthGuard((vars: CompleteQc2Request) => kursunQcService.completeQc2(vars)),
    ...OFFLINE_AWARE,
  });
  // Leke (RollError) ekleme — client-üretimi UUID (clientErrorId) vars'ta.
  // Backend idempotent: aynı id ile 2. çağrı mevcut kaydı döner (PK + P2002
  // catch). KK1 client-barkod pattern'iyle aynı. Operatör offline'ken leke
  // girişine devam edebilsin diye QC2_COMPLETE ile birlikte kuyruğa alınır —
  // ikisinden biri eksikse offline akış yarım kalır.
  queryClient.setMutationDefaults(STATION_MUT.QC2_REPORT_ERROR, {
    mutationFn: withAuthGuard((vars: ReportErrorRequest) => kursunQcService.reportError(vars)),
    ...OFFLINE_AWARE,
  });
  // Leke silme — backend idempotent: kayıt yoksa (replay veya offline'da
  // ekle→sil) başarı döner. Henüz sync olmamış (paused) ekleme silinirse ekran
  // tarafında o mutation kuyruktan iptal edilir, buraya hiç düşmez.
  queryClient.setMutationDefaults(STATION_MUT.QC2_DELETE_ERROR, {
    mutationFn: withAuthGuard((vars: DeleteErrorRequest) => kursunQcService.deleteError(vars)),
    ...OFFLINE_AWARE,
  });
  // Adımı kapat — barkodlu topların hepsi KK2 işaretliyse topluca Tambur'a taşır.
  // Resume FIFO: önce QC2/leke mutation'ları, sonra bu. Backend idempotent: adım
  // zaten kapalıysa (açık movement yok) başarı döner → replay güvenli.
  queryClient.setMutationDefaults(STATION_MUT.QC2_FINISH_STEP, {
    mutationFn: withAuthGuard((vars: FinishStepRequest) => kursunQcService.finishStep(vars)),
    ...OFFLINE_AWARE,
  });
  // Açık kumaş bitirme (fason dönüşü) — barkodlu QC2 ile aynı offline pattern.
  // Backend idempotent: priorFinish check + skipDuplicates RollOperation.
  queryClient.setMutationDefaults(STATION_MUT.KURSUN_FINISH, {
    mutationFn: withAuthGuard((rollId: string) => rollService.kursunFinish(rollId, {})),
    ...OFFLINE_AWARE,
  });
  // Tambur açık kumaş bitirme (Tambur'un son aksiyonu).
  // Backend idempotent: status===TAMBUR_CONSUMED check + cached metadata.
  // Per-cut (cutOpenFabric) hala online-only — label print + per-call barcode.
  queryClient.setMutationDefaults(STATION_MUT.TAMBUR_FINALIZE_OPEN_FABRIC, {
    mutationFn: withAuthGuard((vars: TamburFinalizeOpenFabricVars) =>
      tamburService.finalizeOpenFabric(vars.rollId, {
        remainingAction: vars.remainingAction,
        foldType: vars.foldType,
        // ⚠️ Bu iki satır UNUTULURSA sebep ekranda sorulur, operatör seçer ve
        // İSTEK GÖVDESİNE HİÇ GİRMEZ — defter "BELIRTILMEDI" ile dolar ve
        // kimse sebebini bulamaz. (Kuyruk yolu ile doğrudan çağrı yolu ayrı
        // kod; ikisini birlikte güncelle.)
        varianceReasonCode: vars.varianceReasonCode,
        varianceReasonText: vars.varianceReasonText,
        // Plan-gerçek sapma onayı — üstteki uyarının kapsamında: bu satır
        // düşerse operatör onaylar, bayrak isteğe HİÇ girmez, replay 409'da kalır.
        confirmMismatch: vars.confirmMismatch,
      })),
    ...OFFLINE_AWARE,
  });
  // KK1 ham mal girişi — sunucu-üretimi barkod (T+GGAAYY+H/F+NNNN) vars'ta.
  // Backend idempotent: Roll.barcode @unique + P2002 catch → cached Roll dönüş.
  // Etiket basımı onSuccess'te tetiklenir (LabelPrinter backend HTML çeker) —
  // offline pause durumunda etiket online dönünce basılır.
  queryClient.setMutationDefaults(STATION_MUT.KK1_CREATE_ENTRY, {
    mutationFn: withAuthGuard((vars: InitialEntryRequest) =>
      rollService.createInitialEntry(vars)),
    ...OFFLINE_AWARE,
  });
  // KK1 top iptali (Sil) — offline-aware. Backend softDelete idempotent: top
  // zaten CANCELLED/SCRAP ise no-op başarı döner. STOCK top istasyonda aktif
  // olmadığı için confirmActive gerekmez (önizleme online-only); offline iptal
  // confirmActive=false gider — top bu arada bir istasyonda aktifleştiyse
  // backend conflict atar, replay'de optimistic kaldırma rollback olur.
  queryClient.setMutationDefaults(STATION_MUT.KK1_SCRAP, {
    mutationFn: withAuthGuard(
      (vars: {
        id: string;
        confirmActive: boolean;
        /**
         * "Etiketi toptan söktüm" beyanı.
         *
         * ⚠️ 2026-08-25'ten beri ÖLÜ BİR ALAN: backend ölü etiket guard'ını
         * kaldırdı (kullanıcı kararı — onay bir sektör standardı değildi ve
         * karşılığında bir etiket-toplama süreci hiç kurulmadı). Gönderilmeye
         * devam ediyor çünkü kuyrukta eski kayıtlar olabilir ve zararsız.
         * Kaldırmak istersen ÖNCE kuyruğun boşaldığından emin ol.
         */
        confirmLabelPrinted?: boolean;
        reason?: string;
      }) => {
        // Eski sürümden KUYRUKTA bekleyen kayıtlarda bu alan yok; orada sebebin
        // varlığı onayın da verildiği anlamına geliyordu → geriye dönük çıkarım.
        const confirmLabelPrinted = vars.confirmLabelPrinted ?? !!vars.reason;
        return rollService.scrap(
          vars.id,
          vars.confirmActive,
          confirmLabelPrinted || vars.reason
            ? { confirmLabelPrinted, reason: vars.reason }
            : undefined,
        );
      },
    ),
    ...OFFLINE_AWARE,
  });
  // Fason Kabul — boyahaneden dönen malın kabul kaydı. Backend idempotent:
  // bir step'te bir kez receive olur, 2. çağrı mevcut SubcontractorReceipt'i
  // cached döner.
  queryClient.setMutationDefaults(STATION_MUT.FASON_KABUL_RECEIVE, {
    mutationFn: withAuthGuard((vars: ReceiveRequest) => subcontractorService.receive(vars)),
    ...OFFLINE_AWARE,
  });
  // Fason Sevk — boyahaneye sevk. UX şartı: operatör offline iken irsaliyeyi
  // ELLE yazar, kamyona verir; online dönünce backend gerçek dispatchNo'yu
  // oluşturur. Backend idempotent: aynı step+rollIds+subcontractor payload
  // ile 2. çağrı openDispatch'i cached döner; farklı payload → conflict.
  queryClient.setMutationDefaults(STATION_MUT.FASON_SEVK_DISPATCH, {
    mutationFn: withAuthGuard((vars: DispatchRequest) => subcontractorService.dispatch(vars)),
    ...OFFLINE_AWARE,
  });
  // Kartela Sevk — bitmiş topu kartela firmasına gönder. Backend idempotent:
  // aynı firma + aynı toplarla açık sevk varsa cached döner.
  queryClient.setMutationDefaults(STATION_MUT.KARTELA_SEVK_DISPATCH, {
    mutationFn: withAuthGuard((vars: KartelaDispatchRequest) => kartelaService.dispatch(vars)),
    ...OFFLINE_AWARE,
  });
  // Kartela Kabul — firmadan dönen kartelaların kabulü. Backend idempotent:
  // toplar zaten KARTELA_CONSUMED ise cached receipt döner.
  queryClient.setMutationDefaults(STATION_MUT.KARTELA_KABUL_RECEIVE, {
    mutationFn: withAuthGuard((vars: KartelaReceiveRequest) => kartelaService.receive(vars)),
    ...OFFLINE_AWARE,
  });
}
