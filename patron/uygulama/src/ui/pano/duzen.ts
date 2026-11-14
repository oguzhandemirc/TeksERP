// Pano düzeni (kişiselleştirme): seçili kutuların SIRASI + dönem — cihazda, oturum kapsamı başına (`patron.pano.<kapsam>`).
// Okurken katalogda olmayan anahtar sessizce düşer (veri ucuna 400 gitmez); yazım yalnız kullanıcı eyleminde.
// Telefon düzeni masaüstünden ayrıdır (panel tercihine yazılmaz).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyValue } from "../../state/store";

export interface DuzenKaydi {
  readonly kutular?: readonly string[];
  readonly donem?: string;
}

export interface KatalogKutusu {
  readonly anahtar: string;
  readonly baslik: string;
  readonly aciklama?: string;
  readonly varsayilan: boolean;
}

export const duzenAnahtari = (kapsam: string) => `patron.pano.${kapsam}`;

/** Cihaz deposu tembel yüklenir (`rail-pref` emsali): yerel modül yoksa (test, web gizli kip) düzen yalnız bellekte. */
export function cihazDeposu(): Pick<KeyValue, "get" | "set" | "remove"> | null {
  try {
    return (require("../../state/store") as typeof import("../../state/store")).plainStore;
  } catch {
    return null;
  }
}

/** Kayıt → geçerli sıra (string dışı, tekrar ve katalogda olmayan düşer); kayıt yoksa/bozuksa null. */
export function temizDuzen(saved: unknown, known: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(saved)) return null;
  const out: string[] = [];
  for (const k of saved) if (typeof k === "string" && known.has(k) && !out.includes(k)) out.push(k);
  return out;
}

export function varsayilanDuzen(katalog: readonly KatalogKutusu[]): string[] {
  return katalog.filter((k) => k.varsayilan).map((k) => k.anahtar);
}

/** Bir kutuyu bir adım yukarı (-1) / aşağı (+1) taşır; sınırda değişmez. */
export function tasi(list: readonly string[], key: string, delta: -1 | 1): string[] {
  const i = list.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function parse(raw: string | null): DuzenKaydi | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v !== null && typeof v === "object" ? (v as DuzenKaydi) : null;
  } catch {
    return null;
  }
}

export interface PanoDuzeni {
  /** Çizilecek kutular (sıralı). */
  readonly kutular: readonly string[];
  readonly donem: string | undefined;
  readonly varsayilanMi: boolean;
  readonly hazir: boolean;
  ekle(key: string): void;
  cikar(key: string): void;
  tasi(key: string, delta: -1 | 1): void;
  setDonem(d: string): void;
  sifirla(): void;
}

/** Düzen kancası: `katalog` null iken (yükleniyor) boş düzen döner. */
export function usePanoDuzeni(kapsam: string | null, katalog: readonly KatalogKutusu[] | null, store: Pick<KeyValue, "get" | "set" | "remove"> | null): PanoDuzeni {
  const [kayit, setKayit] = useState<DuzenKaydi | null>(null);
  const [okundu, setOkundu] = useState(false);
  useEffect(() => {
    let live = true;
    setOkundu(false);
    if (!kapsam || !store) {
      setKayit(null);
      setOkundu(true);
      return;
    }
    store
      .get(duzenAnahtari(kapsam))
      .then((raw) => live && setKayit(parse(raw)))
      .catch(() => undefined)
      .finally(() => live && setOkundu(true));
    return () => {
      live = false;
    };
  }, [kapsam, store]);

  const known = useMemo(() => new Set((katalog ?? []).map((k) => k.anahtar)), [katalog]);
  const saved = useMemo(() => temizDuzen(kayit?.kutular, known), [kayit, known]);
  const kutular = useMemo(() => (katalog ? saved ?? varsayilanDuzen(katalog) : []), [katalog, saved]);

  const yaz = useCallback(
    (next: DuzenKaydi | null) => {
      setKayit(next);
      if (!kapsam || !store) return;
      const key = duzenAnahtari(kapsam);
      void (next ? store.set(key, JSON.stringify(next)) : store.remove(key)).catch(() => undefined);
    },
    [kapsam, store],
  );

  return {
    kutular,
    donem: kayit?.donem,
    varsayilanMi: saved === null,
    hazir: okundu && katalog !== null,
    ekle: (key) => (kutular.includes(key) ? undefined : yaz({ ...kayit, kutular: [...kutular, key] })),
    cikar: (key) => yaz({ ...kayit, kutular: kutular.filter((k) => k !== key) }),
    tasi: (key, delta) => yaz({ ...kayit, kutular: tasi(kutular, key, delta) }),
    setDonem: (d) => yaz({ ...kayit, kutular: saved ?? undefined, donem: d }),
    sifirla: () => yaz(kayit?.donem ? { donem: kayit.donem } : null),
  };
}
