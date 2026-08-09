import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { preferencesService, type PreferenceBlob } from '../services/preferences.service';

// =============================================================================
// FASON FİRMA VARSAYILANI — kişisel tercih (2026-08-09)
// =============================================================================
// Saha isteği: *"iş emri oluştururken son seçilen fasoncu otomatik gelsin;
// favori geliyor şu an da."* Kullanıcı kararı: **açılır-kapanır KİŞİSEL tercih**
// — planlamacılar farklı çalışıyor, birini diğerine dayatmak yerine seçtiriyoruz.
//
// ⚠️ Electron ile AYNI tercih blob'u ve AYNI anahtarlar (`workOrders.*`) —
// kullanıcı hangi cihazdan bakarsa baksın aynı davranışı görür. Anahtar adları
// ayrışırsa iki taraf birbirinin ayarını görmez ve kullanıcı "ayarladım ama
// tablette olmadı" der.
//
// ⚠️ Varsayılan `favorite` = BUGÜNKÜ davranış. Yeni davranışı varsayılan yapmak
// sahadaki herkesin alışkanlığını habersiz değiştirirdi.
// =============================================================================

const PREFS_KEY = ['preferences'] as const;

export type SubcontractorDefaultMode = 'favorite' | 'lastUsed';

interface WorkOrderPrefs {
  subcontractorDefault?: SubcontractorDefaultMode;
  lastSubcontractorByCategory?: Record<string, string>;
}

export function useSubcontractorDefault() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => preferencesService.get(),
    staleTime: 5 * 60_000,
  });
  const blob = (q.data ?? {}) as PreferenceBlob & { workOrders?: WorkOrderPrefs };
  const wo = blob.workOrders ?? {};
  const mode: SubcontractorDefaultMode = wo.subcontractorDefault ?? 'favorite';

  const save = useMutation({
    mutationFn: (next: WorkOrderPrefs) =>
      preferencesService.save({ ...blob, workOrders: { ...wo, ...next } } as PreferenceBlob),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });

  /**
   * Kategorinin varsayılan firması. `favoriteFor` çağıranın kendi favori
   * çözümüdür (ekran zaten hesaplıyor) — burada tekrar yazmak iki kaynak olurdu.
   *
   * ⚠️ `lastUsed` seçiliyken bile geçmiş YOKSA favoriye düşülür: boş bırakmak,
   * yeni bir kategoride tercihi açan kullanıcıya "hiçbir şey gelmiyor" dedirtirdi.
   */
  const pickDefault = useCallback(
    (categoryId: string, favoriteFor: (c: string) => string | undefined): string | undefined => {
      const fav = favoriteFor(categoryId);
      if (mode !== 'lastUsed') return fav;
      return wo.lastSubcontractorByCategory?.[categoryId] ?? fav;
    },
    [mode, wo.lastSubcontractorByCategory],
  );

  /**
   * Kategori → en son seçilen firmayı hatırla.
   * ⚠️ Tercih KAPALIYKEN de yazılır — anahtarı sonra çeviren kullanıcı boş bir
   * hafızayla karşılaşmasın.
   */
  const remember = useCallback(
    (pairs: Array<{ categoryId: string | null | undefined; firmId: string | null | undefined }>) => {
      const next = { ...(wo.lastSubcontractorByCategory ?? {}) };
      let changed = false;
      for (const p of pairs) {
        // Kategori + firma İKİSİ de dolu olmalı: biri eksikse hangi kategoriye
        // yazılacağı belirsizdir ve yanlış kategoriye yazmak sonraki iş emrinde
        // sessizce yanlış firma önerirdi.
        if (p.categoryId && p.firmId && next[p.categoryId] !== p.firmId) {
          next[p.categoryId] = p.firmId;
          changed = true;
        }
      }
      if (!changed) return; // gereksiz PUT atma
      save.mutate({ lastSubcontractorByCategory: next });
    },
    [wo.lastSubcontractorByCategory, save],
  );

  const setMode = useCallback(
    (m: SubcontractorDefaultMode) => save.mutate({ subcontractorDefault: m }),
    [save],
  );

  return { mode, setMode, pickDefault, remember, saving: save.isPending };
}
