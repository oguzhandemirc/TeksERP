// =============================================================================
// AppMenu — konum hesabı (SAF katman)
// =============================================================================
// Neden ayrı dosya: konumlama, menünün ekran dışına taşmasını engelleyen TEK
// kuraldır ve bileşenin içinde kalsaydı yalnız cihazda gözle doğrulanabilirdi.
// Burada saf fonksiyon olduğu için birim testiyle kilitlenir (appMenuLayout.test).
//
// TASARIM KARARI — MENÜ KARTI ÖLÇÜLMEZ.
// Kartın genişliği/yüksekliği İÇERİĞE bağlıdır ve onu ölçmek `onLayout` → state →
// yeni layout → `onLayout` … döngüsünün kapısını açar (paper Menu'nün Fabric'te
// "Maximum update depth exceeded" ile çöktüğü yer tam olarak burasıdır). Bunun
// yerine kart YALNIZ TEK KENARINDAN çivilenir ve karşı kenarına `maxWidth` /
// `maxHeight` konur:
//   • sağa taşacaksa SOL yerine SAĞ kenardan çivile (`right`),
//   • alta taşacaksa ÜST yerine ALT kenardan çivile (`bottom`, yani yukarı açılır).
// Böylece kart ne kadar büyürse büyüsün güvenli kutunun dışına ÇIKAMAZ ve
// boyutunun bilinmesine hiç gerek kalmaz.
// =============================================================================

/** Tetiğin pencere (window) koordinatlarındaki dikdörtgeni — `measureInWindow`. */
export interface AppMenuAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Çizim yüzeyi — `useWindowDimensions()`. */
export interface AppMenuViewport {
  width: number;
  height: number;
}

export interface AppMenuLayoutOptions {
  /** Ekran kenarına bırakılan güvenli boşluk. */
  margin?: number;
  /** Tetik ile kart arasındaki dikey nefes payı. */
  gap?: number;
  /**
   * Kartın SIKIŞMADAN durabileceği en dar genişlik. Ölçü değil, HİZALAMA
   * EŞİĞİdir: bu kadar yer yoksa kart karşı kenara yaslanır.
   */
  minWidth?: number;
  /** Aynı eşiğin dikey karşılığı — bu kadar yer yoksa menü yukarı açılır. */
  minHeight?: number;
}

export interface AppMenuLayout {
  /** `left` VEYA `right` dolu olur — ikisi birden asla. */
  left?: number;
  right?: number;
  /** `top` VEYA `bottom` dolu olur — ikisi birden asla. */
  top?: number;
  bottom?: number;
  maxWidth: number;
  maxHeight: number;
  /** true → kart sağ kenarından çivilendi (tetiğin sağına yaslı). */
  alignRight: boolean;
  /** true → kart alt kenarından çivilendi (tetiğin ÜSTÜNDE açılır). */
  openUp: boolean;
}

export const APP_MENU_LAYOUT_DEFAULTS = {
  margin: 8,
  gap: 6,
  minWidth: 200,
  minHeight: 160,
} as const;

/** NaN/Infinity → 0. measureInWindow bağlı olmayan View'da çöp değer dönebilir. */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Tetiğin konumundan menü kartının mutlak yerleşimini üretir.
 *
 * Sözleşme (testte kilitli): dönen kutu HER ZAMAN güvenli kutunun (ekran −
 * `margin`) içindedir; tetik ekran dışında olsa bile.
 */
export function computeAppMenuLayout(
  anchor: AppMenuAnchorRect,
  viewport: AppMenuViewport,
  options: AppMenuLayoutOptions = {},
): AppMenuLayout {
  const margin = options.margin ?? APP_MENU_LAYOUT_DEFAULTS.margin;
  const gap = options.gap ?? APP_MENU_LAYOUT_DEFAULTS.gap;
  const minWidth = options.minWidth ?? APP_MENU_LAYOUT_DEFAULTS.minWidth;
  const minHeight = options.minHeight ?? APP_MENU_LAYOUT_DEFAULTS.minHeight;

  const vw = Math.max(0, finite(viewport.width));
  const vh = Math.max(0, finite(viewport.height));

  // Güvenli çizim kutusu — kartın hiçbir kenarı buradan taşmayacak.
  const safeLeft = margin;
  const safeRight = Math.max(margin, vw - margin);
  const safeTop = margin;
  const safeBottom = Math.max(margin, vh - margin);
  const safeWidth = Math.max(0, safeRight - safeLeft);

  const ax = finite(anchor.x);
  const ay = finite(anchor.y);
  const aw = Math.max(0, finite(anchor.width));
  const ah = Math.max(0, finite(anchor.height));

  // Tetik kenarları, güvenli kutuya kırpılmış hâlde (tetik ekran dışına taşmış
  // olabilir — döner tablette rotasyon sonrası bayat ölçüm gibi).
  const anchorLeft = clamp(ax, safeLeft, safeRight);
  const anchorRight = clamp(ax + aw, safeLeft, safeRight);
  const anchorTop = clamp(ay, safeTop, safeBottom);
  const anchorBottom = clamp(ay + ah, safeTop, safeBottom);

  // ---------------------------------------------------------------------------
  // YATAY — tercih SOL hizalama (paper davranışı), sığmazsa SAĞA yasla.
  // ---------------------------------------------------------------------------
  const spaceIfLeftAligned = safeRight - anchorLeft;
  const spaceIfRightAligned = anchorRight - safeLeft;

  let alignRight = false;
  let left: number | undefined;
  let right: number | undefined;
  let maxWidth: number;

  if (spaceIfLeftAligned >= minWidth) {
    left = anchorLeft;
    maxWidth = spaceIfLeftAligned;
  } else if (spaceIfRightAligned >= minWidth) {
    alignRight = true;
    // RN'de `right`, ekranın SAĞ kenarından uzaklıktır.
    right = Math.max(margin, vw - anchorRight);
    maxWidth = spaceIfRightAligned;
  } else {
    // İki taraf da dar (çok küçük ekran / ortada duran geniş tetik) → kartı
    // güvenli kutunun tamamına yay. Taşmaktansa geniş dur.
    left = safeLeft;
    maxWidth = safeWidth;
  }

  // ---------------------------------------------------------------------------
  // DİKEY — tercih AŞAĞI açılma, sığmazsa (ve yukarısı daha genişse) YUKARI.
  // ---------------------------------------------------------------------------
  const topIfDown = Math.min(anchorBottom + gap, safeBottom);
  const spaceBelow = Math.max(0, safeBottom - topIfDown);
  const bottomEdgeIfUp = Math.max(anchorTop - gap, safeTop);
  const spaceAbove = Math.max(0, bottomEdgeIfUp - safeTop);

  let openUp = false;
  let top: number | undefined;
  let bottom: number | undefined;
  let maxHeight: number;

  if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
    top = topIfDown;
    maxHeight = spaceBelow;
  } else {
    openUp = true;
    // RN'de `bottom`, ekranın ALT kenarından uzaklıktır.
    bottom = Math.max(margin, vh - bottomEdgeIfUp);
    maxHeight = spaceAbove;
  }

  return { left, right, top, bottom, maxWidth, maxHeight, alignRight, openUp };
}
