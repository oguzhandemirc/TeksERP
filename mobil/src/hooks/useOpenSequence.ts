// =============================================================================
// AÇILIŞ SAYACI — sayfalı modal her AÇILIŞTA sayfa 1'den başlasın
// =============================================================================
// `PagedSheet` sayfa durumunu içinde tutar; çağıran açılış sayısını `key` yapar.
// Yalnız kapalı→açık geçişinde artar: kapanışta anahtar değişmez, kapanış animasyonu
// korunur. Render sırasında ref yazımı bilinçli: aynı render tekrarında (StrictMode)
// ikinci geçiş `wasOpen` true gördüğü için artırmaz.
// =============================================================================
import { useRef } from 'react';

export function useOpenSequence(open: boolean): number {
  const seq = useRef(0);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) seq.current += 1;
  wasOpen.current = open;
  return seq.current;
}
