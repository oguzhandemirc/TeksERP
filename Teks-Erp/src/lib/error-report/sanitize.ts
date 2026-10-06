// HATA RAPORU ARINDIRICI — ham hatadan protokolün allowlist alanlarını ÇIKARIR (saf fonksiyonlar). Mesaj metni,
// istek gövdesi, kullanıcı, IP, yol parametresi ve mutlak dosya yolu hiçbir dönüşte yer almaz; çıktı yine de
// gönderilmeden önce protokol şemasından geçer (`ErrorReportEntrySchema`), geçemeyen kayıt düşer.
import {
  ERROR_REPORT_STACK_MAX,
  ErrorClassSchema,
  ErrorCodeSchema,
  ErrorComponentSchema,
  ROUTE_SEGMENT_PATTERN,
  STACK_FRAME_PATTERN,
} from "../license/protocol";

/** Uygulama kökü işaretleri: çerçeve yolu bunların SONUNCUSUNDAN itibaren tutulur; yoksa yalnız dosya adı. */
const ROOT_MARKERS = ["node_modules", "src", "dist", "assets", "build"] as const;
const FRAME_SEGMENTS_MAX = 5;
const SEGMENT = /^[A-Za-z0-9_@.-]+$/;

/** Bilinmeyen değer için sabit etiketler (serbest metin hiçbir zaman geçmez). */
export const FALLBACK_CODE = "UNHANDLED";
export const FALLBACK_CLASS = "Error";
export const FALLBACK_COMPONENT = "bilinmiyor";

/** Yolu şablona çevirir: şablon parçası olmayan her parça (kimlik, sayı, kod, serbest metin) `:p` olur; sorgu atılır. */
export function toRouteTemplate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const pathOnly = raw.split(/[?#]/)[0] ?? "";
  const parts = pathOnly.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const out = parts.slice(0, 12).map((p) => (ROUTE_SEGMENT_PATTERN.test(p) ? p : ":p"));
  const t = `/${out.join("/")}`;
  return t.length <= 200 ? t : null;
}

/** Tek çerçeve konumu → `göreli/yol.ts:satır` ya da null (kullanıcı dizini/mutlak yol/biçimsiz parça giremez). */
export function normalizeFrameLocation(location: string, line: string): string | null {
  let p = location.trim();
  if (p.startsWith("node:") || p.startsWith("internal/")) return null;
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  p = p.split(/[?#]/)[0] ?? "";
  try {
    p = decodeURIComponent(p);
  } catch {
    /* biçimsiz kaçış: ham hâliyle sürer, parça denetimi eler */
  }
  const segments = p.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  let start = segments.length - 1;
  for (const marker of ROOT_MARKERS) {
    const idx = segments.lastIndexOf(marker);
    if (idx >= 0 && idx < segments.length - 1) {
      start = idx;
      break;
    }
  }
  let kept = segments.slice(start);
  if (kept.length > FRAME_SEGMENTS_MAX) kept = [kept[0]!, ...kept.slice(kept.length - (FRAME_SEGMENTS_MAX - 1))];
  if (!kept.every((s) => SEGMENT.test(s) && s !== "..")) kept = segments.slice(-1);
  const frame = `${kept.join("/")}:${line}`;
  return STACK_FRAME_PATTERN.test(frame) ? frame : null;
}

const V8_FRAME = /^\s*at\s+(?:.*?\()?(.+?):(\d+)(?::\d+)?\)?\s*$/;
const JSC_FRAME = /^[^\s@]*@(.+?):(\d+)(?::\d+)?$/;

/** Yığın metni → en çok 8 `dosya:satır`; ilk satır (V8'de `Ad: mesaj`) ve mesaj metni hiç okunmaz. */
export function toStackFrames(stack: unknown): string[] {
  if (typeof stack !== "string" || stack.length === 0) return [];
  const lines = stack.slice(0, 16_000).split("\n");
  const v8 = lines.some((l) => /^\s*at\s/.test(l));
  const out: string[] = [];
  for (const l of lines) {
    const m = v8 ? V8_FRAME.exec(l) : JSC_FRAME.exec(l.trim());
    if (!m || (v8 && !/^\s*at\s/.test(l))) continue;
    const f = normalizeFrameLocation(m[1]!, m[2]!);
    if (f && out[out.length - 1] !== f) out.push(f);
    if (out.length >= ERROR_REPORT_STACK_MAX) break;
  }
  return out;
}

export function toErrorCode(raw: unknown, fallback = FALLBACK_CODE): string {
  return typeof raw === "string" && ErrorCodeSchema.safeParse(raw).success ? raw : fallback;
}

export function toErrorClass(raw: unknown): string {
  return typeof raw === "string" && ErrorClassSchema.safeParse(raw).success ? raw : FALLBACK_CLASS;
}

export function toComponent(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_COMPONENT;
  const c = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 40).replace(/-+$/, "");
  return ErrorComponentSchema.safeParse(c).success ? c : FALLBACK_COMPONENT;
}

/** Sunucu yolunun bileşeni: `/api/<bileşen>/…` → `<bileşen>`. */
export function componentFromRoute(template: string | null): string {
  const parts = (template ?? "").split("/").filter(Boolean);
  const first = parts[0] === "api" ? parts[1] : parts[0];
  return first && !first.startsWith(":") ? toComponent(first) : FALLBACK_COMPONENT;
}
