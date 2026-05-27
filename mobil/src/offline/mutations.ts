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
import { rollService } from '../services/roll.service';

export const STATION_MUT = {
  QC2_COMPLETE: ['station', 'qc2-complete'] as const,
  KURSUN_FINISH: ['station', 'kursun-finish'] as const,
} as const;

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
}
