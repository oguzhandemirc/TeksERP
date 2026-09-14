import { useEffect, useMemo, useState } from 'react';
import { LOOM_STOP_REASONS } from '../constants/loomStopReasons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  reasonPresetService,
  type ReasonPreset,
  type ReasonPresetKind,
} from '../services/reasonPreset.service';
import { SCRAP_REASONS, RECORD_CORRECTION_REASONS } from '../constants/varianceReasons';
import { MANUAL_REASON_PRESETS } from '../constants/manualReasons';
import { CANCEL_REASON_PRESETS } from '../constants/cancelReasons';
import { REWORK_REASON_PRESETS } from '../constants/reworkReasons';
import { storage } from '../utils/storage';

// =============================================================================
// HAZIR SEBEP KATALOĞU — TEK OKUMA NOKTASI (2026-08-19)
// =============================================================================
// Katalog artık sunucuda yaşıyor (fabrika düzenleyebilsin diye), ama Tambur
// ÇEVRİMDIŞI da çalışıyor ve sebep FİRE kararında ZORUNLU. Bu yüzden üç kademeli
// çözüm var ve sırası anlamlı:
//
//   1. Sunucudan gelen liste (react-query)
//   2. Diskteki SON BİLİNEN liste (AsyncStorage — fabrikanın düzenlemeleri dahil)
//   3. APK'ya GÖMÜLÜ zemin (aşağıdaki sabitler)
//
// ⚠️ 3. kademe kaldırılamaz: sunucu erişilemezken boş liste, operatörün fire
// kararını KAYDEDEMEMESİ demektir (sebepsiz "Kaydet" kapalı) — yani malın
// tamburda kilitlenmesi.
//
// ⚠️⚠️ HER KADEME KARARLI REFERANS DÖNDÜRÜR. `q.data ?? []` yazımı 2026-08-15
// saha çökmesinin kök nedeniydi (her render'da yeni dizi → effect döngüsü →
// "Maximum update depth exceeded"). Gömülü zemin modül sabiti, disk ve sunucu
// listeleri `useMemo` ile sabitlenir.
// =============================================================================

export const REASON_PRESETS_QUERY_KEY = ['reason-presets'] as const;
const STORAGE_KEY = 'reason_presets_v1';

/** Gömülü zemin — sunucu hiç okunamadığında kullanılır. `id` sentetiktir. */
function builtin(kind: ReasonPresetKind): ReasonPreset[] {
  const mk = (
    code: string,
    label: string,
    extra: Partial<ReasonPreset> = {},
  ): ReasonPreset => ({
    id: `builtin:${kind}:${code}`,
    kind,
    code,
    label,
    fullText: null,
    requiresText: false,
    sortOrder: 0,
    isActive: true,
    isSystem: true,
    ...extra,
  });
  switch (kind) {
    case 'ROLL_SCRAP':
      return SCRAP_REASONS.map((r) => mk(r.code, r.label, { requiresText: !!r.requiresText }));
    case 'ROLL_RECORD_CORRECTION':
      return RECORD_CORRECTION_REASONS.map((r) =>
        mk(r.code, r.label, { requiresText: !!r.requiresText }),
      );
    case 'ROLL_MANUAL_ENTRY':
      return MANUAL_REASON_PRESETS.map((text, i) =>
        mk(`BUILTIN_${i}`, text, { fullText: text }),
      );
    case 'ROLL_CANCEL':
      return CANCEL_REASON_PRESETS.map((p, i) =>
        mk(`BUILTIN_${i}`, p.short, { fullText: p.full }),
      );
    case 'WORK_ORDER_REWORK':
      // ⚠️ Kodlar GERÇEK katalog kodları (`BUILTIN_*` DEĞİL): bu kind metin
      // saklamaz, sunucu metinden kod TÜRETMEZ — kodu istemci gönderir. Zemin
      // uydurma kod gönderirse rapor anahtarı çöp olur. Sunucu kataloğuyla
      // (`constants/reason-presets.ts` REWORK_REASONS) birebir aynı sıra.
      return REWORK_REASON_PRESETS.map((r) => mk(r.code, r.label, { requiresText: !!r.requiresText }));
    case 'ORDER_CANCEL':
      // Sipariş iptali tablette YAPILMIYOR — çevrimdışı zemin bilerek BOŞ.
      // Gömülü liste yazmak, sunucudaki fabrika metinleriyle sessizce ayrışan
      // ikinci bir katalog demek olurdu; burada zeminin koruduğu bir karar yok.
      return [];
    case 'MACHINE_STOP':
      // Zemin GERÇEK katalog kodlarıyla (`WORK_ORDER_REWORK` kalıbı): kind metin saklamaz, kodu
      // istemci gönderir. Sunucusuzken boş dönse sebep zorunlu karar kilitlenirdi (`test_loom_stop_zemin`).
      return LOOM_STOP_REASONS.map((r) => mk(r.code, r.label));
    case 'WARP_RETURN':
      // Devere tablet ekranı (2026-09-14) sebep kodunu katalogdan seçer; sunucusuzken sarım
      // zaten yapılamaz (online-only, kuyruk yok) — gömülü zemin bir karar korumaz, BOŞ kalır.
      return [];
  }
}

const BUILTIN: Record<ReasonPresetKind, ReasonPreset[]> = {
  ROLL_SCRAP: builtin('ROLL_SCRAP'),
  ROLL_RECORD_CORRECTION: builtin('ROLL_RECORD_CORRECTION'),
  ROLL_MANUAL_ENTRY: builtin('ROLL_MANUAL_ENTRY'),
  ROLL_CANCEL: builtin('ROLL_CANCEL'),
  WORK_ORDER_REWORK: builtin('WORK_ORDER_REWORK'),
  ORDER_CANCEL: builtin('ORDER_CANCEL'),
  MACHINE_STOP: builtin('MACHINE_STOP'),
  WARP_RETURN: builtin('WARP_RETURN'),
};

/** Gömülü satır düzenlenemez — henüz sunucudan okunmamış bir zemindir. */
export function isBuiltinPreset(preset: ReasonPreset): boolean {
  return preset.id.startsWith('builtin:');
}

// Disk kademesi modül düzeyinde tutulur: aynı listeyi dört ekran paylaşıyor,
// her biri ayrı okuma yapsaydı aynı veri dört kez parse edilirdi.
let diskCache: ReasonPreset[] | null = null;
let diskLoaded = false;
const diskListeners = new Set<() => void>();

async function loadDiskCache(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (raw) diskCache = JSON.parse(raw) as ReasonPreset[];
  } catch {
    // Bozuk JSON → zemin kullanılır. Kataloğu okuyamamak ekranı düşürmemeli.
    diskCache = null;
  }
  diskListeners.forEach((fn) => fn());
}

function saveDiskCache(rows: ReasonPreset[]): void {
  diskCache = rows;
  void storage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

/**
 * Bir listenin AKTİF satırları (operatör ekranı için).
 * `all` düzenleme yüzeyinin ihtiyacı olan gizliler dahil listedir.
 */
export function useReasonPresets(kind: ReasonPresetKind, includeInactive = false) {
  const [, force] = useState(0);
  useEffect(() => {
    const notify = () => force((n) => n + 1);
    diskListeners.add(notify);
    void loadDiskCache();
    return () => {
      diskListeners.delete(notify);
    };
  }, []);

  const q = useQuery({
    queryKey: [...REASON_PRESETS_QUERY_KEY, includeInactive],
    queryFn: () => reasonPresetService.list(includeInactive),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    // Diske YALNIZ tam liste yazılır: kısmi (aktif-only) liste yazılsaydı
    // düzenleme ekranı çevrimdışıyken gizli satırları "yok" sanardı.
    if (q.data && includeInactive) saveDiskCache(q.data);
    else if (q.data && !diskCache) saveDiskCache(q.data);
  }, [q.data, includeInactive]);

  const presets = useMemo<ReasonPreset[]>(() => {
    const source = q.data ?? diskCache;
    if (!source) return BUILTIN[kind];
    const rows = source
      .filter((r) => r.kind === kind && (includeInactive || r.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    // Sunucu listesi bu türde BOŞSA zemine düş — boş katalog operatörü kilitler.
    return rows.length > 0 ? rows : BUILTIN[kind];
  }, [q.data, kind, includeInactive]);

  return {
    presets,
    isLoading: q.isLoading && !diskCache,
    /** true → liste APK'ya gömülü zeminden geliyor (sunucu hiç okunamadı). */
    isFallback: presets === BUILTIN[kind],
    refetch: q.refetch,
  };
}

/** Yazma sonrası tüm tüketicileri tazeler (dört ekran aynı satırları paylaşıyor). */
export function useInvalidateReasonPresets() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: REASON_PRESETS_QUERY_KEY });
  };
}
