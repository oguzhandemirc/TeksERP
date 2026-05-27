import { useEffect, useRef } from 'react';

// =============================================================================
// useRefetchOnOpen — modal/sheet açılışında query'yi taze çek.
//
// Liste/picker modal'larında parent'ta sürekli aktif useQuery kullanılır;
// modal kapalıyken cache'leniyor olabilir, açılınca operatör başkasının
// değişikliğini göremiyor. Bu hook visible false→true geçişinde refetch
// tetikler — manuel refresh basmaya gerek kalmaz.
//
//   useRefetchOnOpen(query.refetch, modalOpen);
//
// İlk render'da (henüz açılmamışken) tetiklemez. Modal kapalı kalırken
// her render'da tetiklenmez — yalnızca geçiş anında.
// =============================================================================

export function useRefetchOnOpen(
  refetch: () => void,
  visible: boolean,
): void {
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      refetch();
    }
    prevVisibleRef.current = visible;
  }, [visible, refetch]);
}
