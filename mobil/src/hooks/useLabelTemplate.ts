import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { labelTemplateService } from '../services/labelTemplate.service';
import type { LabelKind, LabelTemplate } from '../types/models';

// =============================================================================
// Etiket template fetch + AsyncStorage cache
// =============================================================================
// App açılışında veya kind görünür olduğunda template listesi fetch edilir;
// kind içindeki default template seçilir. Network kapalıysa cache'ten okur.
// Backend `label-template:read` yetkisi gerektirir; yetki yoksa fallback null.
//
// staleTime=0 + refetchOnMount: planlama Electron'da şablonu güncelledikten
// sonra mobil ekran her açılışta/her print'te güncel default'u alır. Print
// anında LabelPrinter ayrıca `refetch()` çağırarak ekstra güvence sağlar.
// =============================================================================

const CACHE_PREFIX = '@label-template:';

async function readCache(kind: LabelKind): Promise<LabelTemplate | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + kind);
    return raw ? (JSON.parse(raw) as LabelTemplate) : null;
  } catch {
    return null;
  }
}

async function writeCache(kind: LabelKind, tpl: LabelTemplate): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + kind, JSON.stringify(tpl));
  } catch {
    // Cache yazımı kritik değil — sessizce yut.
  }
}

/**
 * Verilen LabelKind için aktif default template'i döner. Önce network'ten alır,
 * başarısızsa cache'ten fallback. Cache her başarılı fetch'te güncellenir.
 *
 * `refetch()` — caller (LabelPrinter) print anında çağırır; Promise döner ve
 * sonuçtaki fresh default'u kullanır. Bu sayede Electron'da yeni yapılan
 * değişiklikler 5 dakika cache beklemeden yansır.
 */
export function useLabelTemplate(kind: LabelKind): {
  template: LabelTemplate | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<LabelTemplate | null>;
} {
  const [cached, setCached] = useState<LabelTemplate | null>(null);

  useEffect(() => {
    let active = true;
    readCache(kind).then((t) => {
      if (active) setCached(t);
    });
    return () => {
      active = false;
    };
  }, [kind]);

  const q = useQuery({
    queryKey: ['label-templates', kind],
    queryFn: () => labelTemplateService.list({ kind }),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 0,
  });

  const fetched = (q.data?.data ?? []).find((t) => t.isDefault) ?? null;

  useEffect(() => {
    if (fetched) void writeCache(kind, fetched);
  }, [fetched, kind]);

  const refetch = async (): Promise<LabelTemplate | null> => {
    const result = await q.refetch();
    const fresh = (result.data?.data ?? []).find((t) => t.isDefault) ?? null;
    if (fresh) await writeCache(kind, fresh);
    return fresh;
  };

  return {
    template: fetched ?? cached,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch,
  };
}
