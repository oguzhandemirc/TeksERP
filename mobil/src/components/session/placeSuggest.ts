// =============================================================================
// Yer onayı öneri mantığı (saf fonksiyonlar — test edilebilir)
// =============================================================================
// "Kolaylaştır ama sistemi bozma" kuralları:
//  - Son oturumun yeri ekranın türüyle eşleşiyorsa → tek dokunuş "Devam" önerisi.
//  - Yoksa: bu türde TEK istasyon + TEK makine (veya makinesiz) → onu öner.
//  - Aksi halde öneri yok → operatör QR okutur veya listeden seçer.
// =============================================================================

import type { LastPlace, SessionPlace } from '../../services/workSession.service';
import type { SessionStationKind } from '../../constants/stationScreens';

export interface PlaceSuggestion {
  stationId: string;
  stationName: string;
  machineId: string | null; // null = makinesiz istasyon-oturumu (SHIPPING)
  machineCode: string | null;
  machineName: string | null;
  source: 'last' | 'single';
}

/** Beklenen türe uyan istasyonlar (liste görünümü de bunu kullanır). */
export function placesOfKind(places: SessionPlace[], kind: SessionStationKind): SessionPlace[] {
  return places.filter((p) => p.kind === kind);
}

export function suggestPlace(
  lastPlace: LastPlace | null,
  places: SessionPlace[],
  expectedKind: SessionStationKind,
): PlaceSuggestion | null {
  // 1) Son oturumun yeri bu ekranın türündeyse → onu öner (rotasyon istisna,
  //    happy path sıfır sürtünme: "Sarım-2'desiniz, doğru mu?").
  if (lastPlace && lastPlace.station.kind === expectedKind && lastPlace.station.isActive) {
    const m = lastPlace.machine;
    if (!m || m.isActive) {
      return {
        stationId: lastPlace.station.id,
        stationName: lastPlace.station.name,
        machineId: m?.id ?? null,
        machineCode: m?.code ?? null,
        machineName: m?.name ?? null,
        source: 'last',
      };
    }
  }
  // 2) Türde TEK istasyon varsa ve makinesizse ya da TEK makinesi varsa → sorma, öner.
  const candidates = placesOfKind(places, expectedKind);
  if (candidates.length === 1) {
    const st = candidates[0];
    if (st.machines.length === 0) {
      return {
        stationId: st.id,
        stationName: st.name,
        machineId: null,
        machineCode: null,
        machineName: null,
        source: 'single',
      };
    }
    if (st.machines.length === 1) {
      const m = st.machines[0];
      return {
        stationId: st.id,
        stationName: st.name,
        machineId: m.id,
        machineCode: m.code,
        machineName: m.name,
        source: 'single',
      };
    }
  }
  return null;
}
