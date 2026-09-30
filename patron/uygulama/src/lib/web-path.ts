// Web adres çubuğundaki fazla eğik çizgi: kenar vekili (Traefik sanitizePath) yolu katlayıp uygulamaya
// iletir, sunucunun 301'i tetiklenmez; `//` tarayıcıda kalırsa expo-router "Invalid URL" ile boş sayfa
// çizer. Katlama yönlendirici başlamadan ÖNCE yapılır (giriş: `entry.ts` → `src/web-path-fix.ts`).

export interface WebLocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface WebWindowLike {
  readonly location?: WebLocationLike;
  readonly history?: { readonly state: unknown; replaceState(data: unknown, unused: string, url?: string): void };
}

/** `//a///b` → `/a/b` (ters eğik çizgi de katlanır); sonuç daima TEK `/` ile başlar ⇒ başka kökene işaret edemez. */
export function foldSlashes(pathname: string): string {
  return `/${pathname.replace(/[/\\]+/g, "/").replace(/^\/+/, "")}`;
}

/** Katlanmış göreli adres (yol + sorgu + hash); yol zaten temizse `null`. */
export function normalizedWebUrl(loc: WebLocationLike): string | null {
  const yol = foldSlashes(loc.pathname);
  return yol === loc.pathname ? null : yol + loc.search + loc.hash;
}

/** Yalnız web'de ve gerekiyorsa adresi yerinde düzeltir (yeniden yükleme yok, geçmişe satır eklenmez). */
export function fixWebLocation(os: string, w: WebWindowLike | undefined): boolean {
  if (os !== "web" || !w?.location || !w.history) return false;
  const hedef = normalizedWebUrl(w.location);
  if (hedef === null) return false;
  w.history.replaceState(w.history.state, "", hedef);
  return true;
}
