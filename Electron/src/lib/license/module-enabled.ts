// =============================================================================
// "MODÜL ETKİN Mİ" — panelde TEK cevap: ham şalter ∧ lisans tavanı ∧ ön koşul zinciri.
// =============================================================================
// Backend `GET /api/feature-flags` modül şalterlerini HAM döndürür (Ayarlar toggle'ı kendi yazdığını
// okusun diye); lisansın kapattığı modül yalnız salt-okunur `license.kapaliModuller`de görünür
// (`docs/kurallar/modul-bayrak.md`). Menü · rota kapısı · karo bu dosyadan okur; ham şalteri yalnız
// Sistem → Modüller toggle'ı okur (`useFeatureFlags({ raw: true })`).
// =============================================================================
import {
  MODULE_DEPENDENCIES,
  MODULE_FIELD_BY_SETTING_KEY,
  MODULE_FLAG_KEYS,
  type ModuleFlagKey,
} from "@/lib/module-flags";
import { ROUTE_ALSO_REQUIRES, routeModuleOf } from "@/lib/route-modules";
import type { FeatureFlagsView } from "@/services/featureFlagService";

type FlagsLike = Partial<Pick<FeatureFlagsView, ModuleFlagKey | "license">> | null | undefined;

/** Bayrak yüklenmemişken alan başına yön: backend okuyucusunun satır-yok değeri (production AÇIK). */
function rawDefault(field: ModuleFlagKey): boolean {
  return field === "productionEnabled";
}

/** Lisansın DOĞRUDAN kapattığı modül alanları (`kapaliModuller` DB anahtarı → panel alanı). Gözlem/eski sunucu → boş. */
function directlyClosed(flags: FlagsLike): Set<ModuleFlagKey> {
  const out = new Set<ModuleFlagKey>();
  for (const m of flags?.license?.kapaliModuller ?? []) {
    const field = MODULE_FIELD_BY_SETTING_KEY[m.anahtar];
    // `production.enabled` lisansta her hâlde açıktır (backend kuralı); listeye girse de kapatılmaz.
    if (field && field !== "productionEnabled") out.add(field);
  }
  return out;
}

/**
 * Lisans yüzünden kapalı modüller — ön koşulu lisansta kapalı olan bağımlı da dahil
 * (emanet kapalı → gelen belge de). Bu küme menüde SOLUK bile çizilmez: modülü açacak şalter yok.
 */
export function licenseClosedModules(flags: FlagsLike): ReadonlySet<ModuleFlagKey> {
  const direct = directlyClosed(flags);
  const out = new Set<ModuleFlagKey>();
  for (const field of MODULE_FLAG_KEYS) {
    let f: ModuleFlagKey | undefined = field;
    while (f) {
      if (direct.has(f)) {
        out.add(field);
        break;
      }
      f = MODULE_DEPENDENCIES[f];
    }
  }
  return out;
}

/** Modül ETKİN mi: ham şalter (yüklenmemişse alan yönü) ∧ lisans izin veriyor ∧ ön koşul da etkin. */
export function isModuleEnabled(flags: FlagsLike, field: ModuleFlagKey): boolean {
  const closed = directlyClosed(flags);
  let f: ModuleFlagKey | undefined = field;
  while (f) {
    const raw = flags?.[f] ?? rawDefault(f);
    if (!raw || closed.has(f)) return false;
    f = MODULE_DEPENDENCIES[f];
  }
  return true;
}

/**
 * `useFeatureFlags` görünümü: modül şalterleri lisans tavanından geçer (zincir UYGULANMAZ — ham
 * okuyucuların bugünkü zincir yazımı korunur). Lisans bir şey kapatmıyorsa AYNI nesne döner.
 */
export function applyLicenseCeiling<T extends FlagsLike>(flags: T): T {
  if (!flags) return flags;
  const closed = directlyClosed(flags);
  if (closed.size === 0) return flags;
  const next: Record<string, unknown> = { ...flags };
  for (const f of closed) if (next[f] === true) next[f] = false;
  return next as T;
}

/** Yol lisansın kapattığı bir modüle mi ait (ekran modülü ya da `ROUTE_ALSO_REQUIRES` ek modülü)? */
export function isPathLicenseClosed(path: string, closed: ReadonlySet<ModuleFlagKey> | undefined): boolean {
  if (!closed || closed.size === 0) return false;
  const m = routeModuleOf(path);
  if (m && closed.has(m)) return true;
  const segs = path.split("/").filter(Boolean);
  for (let n = segs.length; n > 0; n--) {
    const extra = ROUTE_ALSO_REQUIRES[segs.slice(0, n).join("/")];
    if (extra?.some((f) => closed.has(f))) return true;
  }
  return false;
}
