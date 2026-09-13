// =============================================================================
// Belge tarih biçimlendirme — TEK KAYNAK (on iki renderer'ın ortak yardımcısı)
// =============================================================================
// Her renderer aynı `fmtDate` üçlüsünü kendi içinde taşıyordu ve hepsi
// `getDate()/getMonth()/getFullYear()` ile SÜREÇ saat dilimini okuyordu: UTC
// kurulan sunucuda 21:00Z sonrası belge tarihi bir gün geri basılırdı. Gün ve
// saat artık fabrika dilimindendir (`constants/time.ts`); gösterim biçimi aynen
// `GG.AA.YYYY` / `GG.AA.YYYY SS:DD`, boş/geçersiz girdide `fallback`.

import { factoryDateTimeTr, factoryDateTr } from "../../constants/time";

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `GG.AA.YYYY`; boş ya da geçersiz girdide `fallback` (varsayılan boş dize). */
export function fmtDate(iso: string | null | undefined, fallback = ""): string {
  const d = parse(iso);
  return d ? factoryDateTr(d) : fallback;
}

/** `GG.AA.YYYY SS:DD`; boş ya da geçersiz girdide `fallback` (varsayılan "—"). */
export function fmtDateTime(iso: string | null | undefined, fallback = "—"): string {
  const d = parse(iso);
  return d ? factoryDateTimeTr(d) : fallback;
}
