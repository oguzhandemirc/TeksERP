import type { LucideIcon } from "lucide-react";
import { operationsTiles, type OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { operationGroups } from "@/pages/Operations/groups-config";
import { reportTiles } from "@/pages/Reports/tile-config";
import { BOSS_PATH } from "@/lib/boss-path";

/**
 * ÖZET GÖRÜNÜMÜNÜN (BossShell) YÜZEY LİSTESİ — TEK KAYNAK.
 *
 * Kullanıcının talebi: *"kolay bir arayüz ile operasyonları ve raporları
 * görebilmek istiyorum; fazlalık olan yüzeyler gözükmesin."* Bu modül o kararın
 * tek yazılı hâlidir ve İKİ tüketicisi vardır:
 *   ① `BossMenu` — hangi bağlantılar ÇİZİLİR,
 *   ② `BossRootLayout` — hangi yollar AÇILIR (hash ile doğrudan gidilirse).
 *
 * ⚠️ İKİSİ AYNI YÜKLEMDEN BESLENMEK ZORUNDA. Ayrışırlarsa iki arıza doğar ve
 * ikisi de sessizdir: menüde olmayan bir yol açılabilir kalır (daraltma hiç
 * olmamış olur) ya da menüdeki bir bağlantı "kullanılamıyor" sayfasına düşer
 * (`tile-config.permissionAny` ↔ `content-routes.requireAnyPermission`
 * ayrışmasının birebir aynısı — o vaka bu depoda bir kez yaşandı).
 *
 * ⚠️ BU BİR İZİN KAPISI DEĞİL, KABUK KARARIDIR. Backend kapıları (izin, modül
 * anahtarı, uzak denylist) aynen yerinde durur; burada gizlenen bir yüzey tam
 * panelde hâlâ yetkiye göre açılır. "Menüde yok" ile "yetkisi yok" AYRI
 * cümlelerdir — bu ayrım kaybolursa özet görünümü bir güvenlik yüzeyi sanılır
 * ve gerçek kapılar gevşetilir.
 *
 * ⚠️ MENÜ KOPYALANMAZ, TÜRETİLİR. Başlık/ikon/izin/`visibleWhen` bilgisi
 * `operationsTiles` ve `reportTiles` içinde yaşamaya devam eder; burada yalnız
 * SÜZÜLÜR. Elle bir liste yazılsaydı yeni bir operasyon karosu eklendiği gün
 * özet görünümünde eksik kalırdı (ve kimse fark etmezdi).
 */

/**
 * Özet görünümünde açılmasına izin verilen KÖK yol segmentleri.
 *
 * ⚠️ SEGMENT BAZLI, düz `startsWith` DEĞİL: `startsWith("operations")` yarın
 * eklenecek bir `/operations-archive` yolunu da sessizce içeri alırdı.
 *
 * `forbidden` listede çünkü `ProtectedRoute` yetkisiz kullanıcıyı oraya
 * yollar — dışarıda bırakmak, izin hatasını "bu ekran özet görünümünde yok"
 * yalanıyla maskelerdi (iki farklı arızayı tek ekrana toplamak teşhisi öldürür).
 */
export const BOSS_ALLOWED_SEGMENTS: ReadonlySet<string> = new Set([
  BOSS_PATH.slice(1), // "boss"
  "operations",
  "reports",
  "forbidden",
]);

/**
 * Bu yol özet görünümünde açılabilir mi? **FAIL-CLOSED** — tanınmayan her yol
 * kapalıdır.
 *
 * Kök (`/`) BİLEREK listede YOK: özet görünümünde tam panelin Dashboard'ı
 * gösterilmez. Ama orası bir ÇIKMAZ değildir — `BossRootLayout` kökü özete
 * yönlendirir (`Navigate`), "kullanılamıyor" sayfasına düşürmez. Ayrım önemli:
 * kök, kullanıcının TIKLADIĞI bir yer değil, geri okunun düşebileceği bir
 * yerdir; oraya hata sayfası basmak, hatayı kullanıcının yapmadığı bir şey için
 * göstermek olurdu.
 */
export function isBossAllowedPath(pathname: string): boolean {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? "";
  const first = clean.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!first) return false; // kök — ayrı ele alınır (bkz. üstteki not)
  return BOSS_ALLOWED_SEGMENTS.has(first.toLowerCase());
}

export interface BossMenuItem {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
}

export interface BossMenuSection {
  key: string;
  title: string;
  items: BossMenuItem[];
}

/** Menüyü kuran süzgeçlerin ihtiyacı — `useRoleAccess` + operasyon bağlamı. */
export interface BossMenuInput {
  hasPermission: (perm: string) => boolean;
  hasAnyPermission: (perms: string[]) => boolean;
  /** `hasAdminAccess` — Raporlar hub'ının süzgeciyle HİZA için (aşağıdaki not). */
  isAdmin: boolean;
  ctx: OperationsVisibilityContext;
}

/**
 * Özet görünümünün menüsü: Operasyonlar (akış sırasına göre gruplu) + Raporlar.
 *
 * ⚠️ SÜZGEÇLER HUB SAYFALARININ BİREBİR AYNISI olmak zorunda:
 *   • Operasyon → `OperationsHubPage`: `visibleWhen` sonra izin.
 *   • Raporlar  → `ReportsHubPage`: `isAdmin ||` kısa devresi DAHİL.
 * `isAdmin` kısa devresi `reportTiles` yorumunda "bilinen tuzak" olarak
 * kayıtlıdır ve burada BİLEREK KOPYALANIYOR: menüyü hub'dan daha DAR yapmak,
 * kullanıcının `/reports` hub'ında gördüğü bir karoyu menüde bulamaması demek
 * olurdu. Tuzak düzeltilecekse İKİ yerde birden düzeltilir.
 */
export function buildBossMenu(input: BossMenuInput): BossMenuSection[] {
  const { hasPermission, hasAnyPermission, isAdmin, ctx } = input;

  const opsVisible = operationsTiles.filter((t) => {
    if (t.visibleWhen && !t.visibleWhen(ctx)) return false;
    return t.permissionAny
      ? hasAnyPermission(t.permissionAny)
      : !t.permission || hasPermission(t.permission);
  });

  const sections: BossMenuSection[] = [];

  for (const group of operationGroups) {
    const items = opsVisible
      .filter((t) => t.group === group.key)
      .map<BossMenuItem>((t) => ({
        key: t.key,
        title: t.title,
        description: t.description,
        icon: t.icon,
        to: t.to,
      }));
    if (items.length > 0) sections.push({ key: `ops:${group.key}`, title: group.title, items });
  }

  const reportItems = reportTiles
    .filter((t) => {
      if (t.featureFlag && !ctx[t.featureFlag]) return false;
      return isAdmin || !t.permission || hasPermission(t.permission);
    })
    .map<BossMenuItem>((t) => ({
      key: t.key,
      title: t.title,
      description: t.description,
      icon: t.icon,
      to: t.to,
    }));
  if (reportItems.length > 0) {
    sections.push({ key: "reports", title: "Raporlar", items: reportItems });
  }

  return sections;
}
