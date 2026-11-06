// Tambur "Kime?" varsayılanı (prova 2026-11-06): fason (EMANET) topta hedef malın SAHİBİDİR — siparişsiz/fason İE'nin
// müşterisi topların sahibidir (is-emri.md, sevkiyat.md). Sahipsiz (kendi) topta bugünkü davranış: Stok.
import { useEffect, useRef } from 'react';

export interface OwnerRef {
  id: string;
  name: string;
}

/**
 * Top başına BİR kez karar verir: 'apply' → hedefi sahibe çek; 'mark' → operatör zaten hedef seçmiş, dokunma ama bir
 * daha da önerme; 'none' → bekle (ayar yüklenmedi / sahipsiz top / bu top için karar verildi). Böylece operatörün
 * sonradan "Stok" seçimi ezilmez.
 */
export function ownerDefaultDecision(a: {
  rollId: string | null | undefined;
  owner: OwnerRef | null | undefined;
  hasTarget: boolean;
  decidedFor: string | null;
}): 'apply' | 'mark' | 'none' {
  if (!a.rollId || !a.owner || a.decidedFor === a.rollId) return 'none';
  return a.hasTarget ? 'mark' : 'apply';
}

/**
 * Ekran bağlayıcısı: top değişince (ya da temizlenince) karar yeniden verilir. Dönen işlev, ekran çalışma durumunu
 * aynı top için sıfırladığında (katalog/plan değişimi) çağrılır → hedef yeniden sahibe çekilir.
 */
export function useOwnerDefaultTarget(
  rollId: string | null | undefined,
  owner: OwnerRef | null | undefined,
  hasTarget: boolean,
  apply: (owner: OwnerRef) => void,
): () => void {
  const decidedFor = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!rollId) {
      decidedFor.current = null;
      return;
    }
    const d = ownerDefaultDecision({ rollId, owner, hasTarget, decidedFor: decidedFor.current });
    if (d === 'none') return;
    decidedFor.current = rollId;
    if (d === 'apply' && owner) applyRef.current(owner);
  }, [rollId, owner, hasTarget]);
  return () => {
    decidedFor.current = null;
  };
}
