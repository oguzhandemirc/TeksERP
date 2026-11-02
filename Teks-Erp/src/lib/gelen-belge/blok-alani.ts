// Çok bloklu belgede (çeki listesi) blok iş kimliği: başlığa giden değer (başlık blok 1'i taşır; S2b müşteri sipariş no)
// ve bloklar arası fark uyarısı. `taslak.ts` max-lines tavanında olduğu için ayrı dosyada; çağıran `draftFromExtraction`.
import type { RegionExtraction } from "./motor";

/** Blok başına okunup bloklar arasında farkı uyarılan iş kimliği alanları (sipariş · parti · boyahane iş emri · işlem). */
const BLOCK_ID_KEYS = ["siparisNo", "hamPartiNo", "isEmriNo", "islem"];
// Gönderenin (boyahane) iş emri numarası belgedeki adıyla "İE No"; bizim terbiye iş emrimizle karışmasın.
export const FIELD_LABEL: Record<string, string> = {
  siparisNo: "sipariş", hamPartiNo: "parti", isEmriNo: "İE No", islem: "işlem",
  fisNo: "Fiş No", irsaliyeNo: "İrsaliye No", evrakNo: "Evrak No", sevkNo: "Sevk No", belgeNo: "Belge No",
};

/** İlk bölgenin EN KÜÇÜK numaralı bloğunun alanı; blok bandı yoksa (ya da blokta boşsa) bölgenin başlık alanı. */
export function firstBlockValue(reg: RegionExtraction | undefined, key: string): string | null {
  const blocks = [...(reg?.blockFields ?? [])].sort((a, b) => a.blockNo - b.blockNo);
  return blocks[0]?.fields[key]?.value || reg?.fields?.fields[key]?.value || null;
}

/** Bloklar farklı sipariş/parti/iş emri/işlem taşıyorsa TEK uyarı (başlık yalnız blok 1'i taşır). */
export function blockDiffWarning(reg: RegionExtraction, blockOffset: number): string | null {
  if (reg.blockFields.length < 2) return null;
  const differing = BLOCK_ID_KEYS.filter((k) => new Set(reg.blockFields.map((b) => b.fields[k]?.value ?? null).filter((v) => v !== null)).size > 1);
  if (differing.length === 0) return null;
  const desc = reg.blockFields
    .map((b) => `blok ${blockOffset + b.blockNo}: ${differing.map((k) => `${FIELD_LABEL[k] ?? k} ${b.fields[k]?.value ?? "?"}`).join(", ")}`)
    .join(" · ");
  return `BLOCK_IDS_DIFFER: belgede ${reg.blockFields.length} blok farklı iş kimliği taşıyor (${desc}) — başlık yalnız ilk bloğu gösterir; satır işlemi kendi bloğundan`;
}
