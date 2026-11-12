import { useEffect, useRef, useState } from "react";

/** `active` bitse de simge en az `minMs` dönsün ki yenileme gözle görülsün (yalnız gösterim). */
export function useSpinWhile(active: boolean, minMs = 600): boolean {
  const [spinning, setSpinning] = useState(active);
  const startedAt = useRef(0);
  useEffect(() => {
    if (active) {
      startedAt.current = Date.now();
      setSpinning(true);
      return;
    }
    const rest = minMs - (Date.now() - startedAt.current);
    if (rest <= 0) {
      setSpinning(false);
      return;
    }
    const t = setTimeout(() => setSpinning(false), rest);
    return () => clearTimeout(t);
  }, [active, minMs]);
  return spinning || active;
}
