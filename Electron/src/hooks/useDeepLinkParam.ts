import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Derin bağlantı parametresini BİR KEZ tüketir (`?action=new`, `?focus=<id>`): değer varsa `onValue` çağrılır,
 * parametre adresten silinir ki yenileme/yeniden çizim tekrar tetiklemesin (Kartela `?action=` emsali).
 * Pano hızlı işlemleri ve son hareketler satırları bu yolla diyalog/detay açar.
 */
export function useDeepLinkParam(name: string, onValue: (value: string) => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const cb = useRef(onValue);
  cb.current = onValue;
  const value = searchParams.get(name);
  useEffect(() => {
    if (!value) return;
    cb.current(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(name);
        return next;
      },
      { replace: true },
    );
  }, [name, value, setSearchParams]);
}
