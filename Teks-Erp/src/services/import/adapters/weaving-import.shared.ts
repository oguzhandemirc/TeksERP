// =============================================================================
// DOKUMA İÇE AKTARIM ORTAK PARÇALARI (SY-H2) — iplik çözümü, kanonik hücre biçimleri
// =============================================================================
// İplik referansı `item` çözücüsünden geçer, sonra İPLİK + denye koşulu burada ölçülür: servis aynı
// kuralı yazımda 400 ile verir, önizleme onu ÖNCEDEN söylemezse "Yeni" deyip uygulamada patlar.
// Kanonik biçim: hücre metni normalize edilir ve diff yeniden kurulur — yazım biçimi farkı
// ("a=y1" / "A=Y1") değişiklik sayılmaz, geri sarmanın `to` claim'i de bu biçimi taşır.
import prisma from "../../../lib/prisma";
import { resolveReference } from "../import-lookup";
import type { ImportContext, PreparedRow } from "../import.types";

/** İplik kodunu çözer; İPLİK değilse ya da denyesi boşsa satır hatası. Dönüş: id ya da null. */
export async function resolveYarnCode(
  row: PreparedRow,
  { column, code }: { column: string; code: string },
  ctx: ImportContext,
  opts: { requireDenier?: boolean } = {},
): Promise<string | null> {
  const out = await resolveReference("item", code, ctx, "code", { itemType: "YARN" });
  if (out.error) {
    // Yaratma ipucu (`fix`) bilerek düşer: paneldeki hızlı yaratma KUMAŞ açar, iplik değil.
    row.result.errors.push({ column, message: out.error.message });
    return null;
  }
  if (out.warning) row.result.warnings.push({ column, message: out.warning });
  if (!out.hit) return null;
  const item = await prisma.item.findUnique({
    where: { id: out.hit.id },
    select: { itemType: true, linearDensityDen: true },
  });
  if (item?.itemType !== "YARN") {
    row.result.errors.push({ column, message: `'${code}' bir İPLİK kalemi değil — yalnız iplik seçilir.` });
    return null;
  }
  if (opts.requireDenier !== false && item.linearDensityDen === null) {
    row.result.errors.push({ column, message: `'${code}' ipliğinin denye değeri boş — kalem kartından girin.` });
    return null;
  }
  return out.hit.id;
}

/** Normalize edilmiş değeri yazar ve o alanın diff'ini yeniden kurar; değişiklik kalmazsa SKIP. */
export function setCanonical(row: PreparedRow, key: string, next: string | null): void {
  row.values[key] = next;
  if (!row.existing) return;
  const prev = (row.existing[key] as string | null | undefined) ?? null;
  const changes = (row.result.changes ??= {});
  if (prev === next) delete changes[key];
  else changes[key] = { from: prev, to: next };
  if (row.result.action === "UPDATE" && Object.keys(changes).length === 0) row.result.action = "SKIP";
  if (row.result.action === "SKIP" && Object.keys(changes).length > 0) row.result.action = "UPDATE";
}

/** Geri sarmanın sentetik satırı küme değerini dizi olarak verebilir (`[]` = boş küme). */
export function cellText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.length === 0 ? null : raw.map(String).join(";");
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/** Armür ızgarası hücresi: atkı satırları `;` (ya da satır sonu) ile, her satır çerçeve başına 0/1. */
export function parseLiftPlanCell(text: string): { plan?: number[][]; error?: string } {
  const rows = text
    .split(/[;\n]/)
    .map((r) => r.replace(/[\s,]/g, ""))
    .filter((r) => r.length > 0);
  if (rows.length === 0) return { error: "Armür ızgarası boş." };
  for (const [i, r] of rows.entries()) {
    if (!/^[01]+$/.test(r)) return { error: `Armür ızgarasının ${i + 1}. atkı satırında yalnız 0/1 olabilir.` };
  }
  return { plan: rows.map((r) => [...r].map((c) => (c === "1" ? 1 : 0))) };
}

export function encodeLiftPlan(plan: unknown): string | null {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  return (plan as unknown[][]).map((r) => r.map((c) => (c === 1 ? "1" : "0")).join("")).join(";");
}

/** Atkı değişim hücresi `A=IPLIK1; C=IPLIK2` → [{letter, code}]; harf kart sırasıdır (A = 0). */
export function parseWeftChangesCell(text: string): { pairs?: Array<{ sortOrder: number; code: string }>; error?: string } {
  const parts = text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean);
  const pairs: Array<{ sortOrder: number; code: string }> = [];
  for (const p of parts) {
    const m = /^([A-Za-z])\s*=\s*(.+)$/.exec(p);
    if (!m) return { error: `'${p}' okunamadı — biçim: A=İPLİKKODU; C=İPLİKKODU` };
    pairs.push({ sortOrder: m[1]!.toUpperCase().charCodeAt(0) - 65, code: m[2]!.trim() });
  }
  if (new Set(pairs.map((p) => p.sortOrder)).size !== pairs.length) return { error: "Aynı atkı harfi iki kez yazılamaz." };
  return { pairs: pairs.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export function encodeWeftChanges(pairs: Array<{ sortOrder: number; code: string }>): string | null {
  if (pairs.length === 0) return null;
  return [...pairs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => `${String.fromCharCode(65 + p.sortOrder)}=${p.code}`)
    .join(";");
}
