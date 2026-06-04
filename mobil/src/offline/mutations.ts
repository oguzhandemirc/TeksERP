// İstasyon mutation registry.
//
// PersistQueryClientProvider mutation'ın FN referansını persist edemez (sadece
// variables ve state). App restart sonrasında paused mutation FN'ini bulamazsa
// resume çalışmaz. Çözüm: mutationFn'leri global setMutationDefaults ile
// mutationKey'e bağla; component'ler sadece mutationKey kullansın.
//
// TanStack Query v5 default `shouldDehydrateMutation` zaten yalnızca
// isPaused=true mutation'ları persist eder — tamamlanmış olanlar yer kaplamaz.

import { queryClient } from './queryClient';
import {
  kursunQcService,
  type CompleteQc2Request,
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
  KURSUN_FINISH: ['station', 'kursun-finish'] as const,
  TAMBUR_FINALIZE_OPEN_FABRIC: ['station', 'tambur-finalize-open-fabric'] as const,
  KK1_CREATE_ENTRY: ['station', 'kk1-create-entry'] as const,
  FASON_KABUL_RECEIVE: ['station', 'fason-kabul-receive'] as const,
  FASON_SEVK_DISPATCH: ['station', 'fason-sevk-dispatch'] as const,
  KARTELA_SEVK_DISPATCH: ['station', 'kartela-sevk-dispatch'] as const,
  KARTELA_KABUL_RECEIVE: ['station', 'kartela-kabul-receive'] as const,
} as const;

export interface TamburFinalizeOpenFabricVars {
  rollId: string;
  remainingAction: TamburFinalizeRemainingAction;
  foldType: string | null;
}

const OFFLINE_AWARE = {
  networkMode: 'online' as const,
  retry: 3,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
};

export function registerStationMutationDefaults(): void {
  // queryClient default 'always' — burada explicit'ten 'online'a override:
  // offline'da pause + AsyncStorage persist + online resume.
  queryClient.setMutationDefaults(STATION_MUT.QC2_COMPLETE, {
    mutationFn: (vars: CompleteQc2Request) => kursunQcService.completeQc2(vars),
    ...OFFLINE_AWARE,
  });
  // Açık kumaş bitirme (fason dönüşü) — barkodlu QC2 ile aynı offline pattern.
  // Backend idempotent: priorFinish check + skipDuplicates RollOperation.
  queryClient.setMutationDefaults(STATION_MUT.KURSUN_FINISH, {
    mutationFn: (rollId: string) => rollService.kursunFinish(rollId, {}),
    ...OFFLINE_AWARE,
  });
  // Tambur açık kumaş bitirme (Tambur'un son aksiyonu).
  // Backend idempotent: status===TAMBUR_CONSUMED check + cached metadata.
  // Per-cut (cutOpenFabric) hala online-only — label print + per-call barcode.
  queryClient.setMutationDefaults(STATION_MUT.TAMBUR_FINALIZE_OPEN_FABRIC, {
    mutationFn: (vars: TamburFinalizeOpenFabricVars) =>
      tamburService.finalizeOpenFabric(vars.rollId, {
        remainingAction: vars.remainingAction,
        foldType: vars.foldType,
      }),
    ...OFFLINE_AWARE,
  });
  // KK1 ham mal girişi — client-üretimi barkod (TEKS-YYYYMMDD-XXXXXXXX) vars'ta.
  // Backend idempotent: Roll.barcode @unique + P2002 catch → cached Roll dönüş.
  // Etiket basımı onSuccess'te tetiklenir (LabelPrinter backend HTML çeker) —
  // offline pause durumunda etiket online dönünce basılır.
  queryClient.setMutationDefaults(STATION_MUT.KK1_CREATE_ENTRY, {
    mutationFn: (vars: InitialEntryRequest) =>
      rollService.createInitialEntry(vars),
    ...OFFLINE_AWARE,
  });
  // Fason Kabul — boyahaneden dönen malın kabul kaydı. Backend idempotent:
  // bir step'te bir kez receive olur, 2. çağrı mevcut SubcontractorReceipt'i
  // cached döner.
  queryClient.setMutationDefaults(STATION_MUT.FASON_KABUL_RECEIVE, {
    mutationFn: (vars: ReceiveRequest) => subcontractorService.receive(vars),
    ...OFFLINE_AWARE,
  });
  // Fason Sevk — boyahaneye sevk. UX şartı: operatör offline iken irsaliyeyi
  // ELLE yazar, kamyona verir; online dönünce backend gerçek dispatchNo'yu
  // oluşturur. Backend idempotent: aynı step+rollIds+subcontractor payload
  // ile 2. çağrı openDispatch'i cached döner; farklı payload → conflict.
  queryClient.setMutationDefaults(STATION_MUT.FASON_SEVK_DISPATCH, {
    mutationFn: (vars: DispatchRequest) => subcontractorService.dispatch(vars),
    ...OFFLINE_AWARE,
  });
  // Kartela Sevk — bitmiş topu kartela firmasına gönder. Backend idempotent:
  // aynı firma + aynı toplarla açık sevk varsa cached döner.
  queryClient.setMutationDefaults(STATION_MUT.KARTELA_SEVK_DISPATCH, {
    mutationFn: (vars: KartelaDispatchRequest) => kartelaService.dispatch(vars),
    ...OFFLINE_AWARE,
  });
  // Kartela Kabul — firmadan dönen kartelaların kabulü. Backend idempotent:
  // toplar zaten KARTELA_CONSUMED ise cached receipt döner.
  queryClient.setMutationDefaults(STATION_MUT.KARTELA_KABUL_RECEIVE, {
    mutationFn: (vars: KartelaReceiveRequest) => kartelaService.receive(vars),
    ...OFFLINE_AWARE,
  });
}
