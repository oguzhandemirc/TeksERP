import type { LicenseAcceptanceState, LicenseAcceptanceView } from "@/types/license";

/**
 * Etkinleştirme düğmelerinin TEK kapısı (çevrimiçi · bu bilgisayar üzerinden · QR): sözleşme bu sunucuda
 * geçerli biçimde kabul edilmeden hiçbiri çalışmaz. Kabul okunamazsa kapalı kalır (fail-closed) — backend
 * de satıcı da ayrıca reddeder, düğme yalnız boşa istek atmayı önler.
 */
export interface AcceptanceGate {
  readonly ready: boolean;
  readonly reason: string | null;
}

const STATE_REASON: Record<Exclude<LicenseAcceptanceState, "GECERLI">, string> = {
  YOK: "Etkinleştirmeden önce lisans sözleşmesini kabul edin.",
  METIN_DEGISTI: "Sözleşme metni güncellendi; etkinleştirmeden önce yeni metni kabul edin.",
  ANAHTAR_DEGISTI: "Bu sunucunun lisans anahtarı değişti; sözleşmeyi bu sunucuda yeniden kabul edin.",
};

const isRouteMissing = (err: unknown): boolean =>
  (err as { response?: { status?: number } } | null)?.response?.status === 404;

export function acceptanceGate(q: { isLoading: boolean; error: unknown; data: LicenseAcceptanceView | undefined }): AcceptanceGate {
  if (q.data?.durum === "GECERLI") return { ready: true, reason: null };
  if (q.data) return { ready: false, reason: STATE_REASON[q.data.durum] };
  if (q.error) {
    return {
      ready: false,
      reason: isRouteMissing(q.error)
        ? "Sunucu sürümü sözleşme kabulünü desteklemiyor; önce sunucuyu güncelleyin."
        : "Sözleşme kabulü okunamadı; sayfayı yenileyin.",
    };
  }
  return { ready: false, reason: q.isLoading ? "Sözleşme kabulü okunuyor…" : "Etkinleştirmeden önce lisans sözleşmesini kabul edin." };
}

export interface InlineSegment {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Metnin satır içi vurgusu (`**kalın**`, `*eğik*`) — yalnız biçim; kelimeler olduğu gibi kalır. */
export function inlineSegments(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false, italic: false });
    out.push(m[1] !== undefined ? { text: m[1], bold: true, italic: false } : { text: m[2]!, bold: false, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false, italic: false });
  return out;
}
