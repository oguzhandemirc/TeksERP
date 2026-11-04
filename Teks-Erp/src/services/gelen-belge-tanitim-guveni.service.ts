// =============================================================================
// GELEN BELGE — TANITIM DURUMU + GÜVEN KİPİ (`gelenBelge.tanitimGuveni`, K30-B, 2026-11-04)
// =============================================================================
// Belge elle tanıtılmış (kullanıcı şablonu `u-…`) mı, sözlüğe mi düştü (GENEL) — okuma özetinin `tanitim` alanı ve
// SORMA kipinde parti/metre/müşteri türetiminin kipi (`TrustMode`) BURADAN çıkar; okuma anı (taslak doldurma) ve okuma
// özeti aynı saf fonksiyonları kullanır. Sistem (yerleşik) şablonu tutan belge "tanıtım" sorusunun dışındadır (bugünkü).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { FALLBACK_TEMPLATE_CODE, USER_TEMPLATE_PREFIX } from "./gelen-belge-sablon.service";
import { readTanitimGuveni, type TanitimGuveniMode } from "./system-setting.service";
import type { TrustMode } from "./gelen-belge-parti-metre.service";
import { loadUserTemplates } from "./gelen-belge-ozel-sablon.service";
import { templateByCode } from "../lib/gelen-belge/sablon-bul";

/** Tel sözleşmesi madde 1 — okuma özetinin `data.tanitim` alanı. */
export type TanitimInfo = { durum: "TANITILDI"; sablonKodu: string; sablonAdi: string } | { durum: "TANITILMAMIS" };
export type IntroState = { durum: "TANITILDI"; sablonKodu: string } | { durum: "TANITILMAMIS" } | null;

/**
 * Saf: bölgelerin şablon kodlarından tanıtım durumu. Herhangi bir bölge kullanıcı şablonuyla → TANITILDI (ilk `u-`);
 * hiçbir bölge şablon tutmadıysa (GENEL/null, en az bir bölge) → TANITILMAMIS; sistem şablonu tuttuysa ya da bölge yoksa null.
 */
export function introStateOf(templateIds: ReadonlyArray<string | null | undefined>): IntroState {
  const user = templateIds.find((c): c is string => typeof c === "string" && c.startsWith(USER_TEMPLATE_PREFIX));
  if (user) return { durum: "TANITILDI", sablonKodu: user };
  if (templateIds.length === 0) return null;
  return templateIds.every((c) => !c || c === FALLBACK_TEMPLATE_CODE) ? { durum: "TANITILMAMIS" } : null;
}

/** Saf: SOR → NORMAL (bugünkü) · SORMA + tanıtılmış → TRUSTED · SORMA + tanıtılmamış → BLIND · sistem şablonu → NORMAL. */
export function trustModeOf(mode: TanitimGuveniMode, st: IntroState): TrustMode {
  if (mode !== "SORMA" || !st) return "NORMAL";
  return st.durum === "TANITILDI" ? "TRUSTED" : "BLIND";
}

/** Okuma anı: bu taramanın bölgelerinden kip (ayar o an okunur; sonradan değişim yazılmış kolonu değiştirmez). */
export async function trustModeForRegions(templateIds: ReadonlyArray<string | null | undefined>): Promise<TrustMode> {
  return trustModeOf(await readTanitimGuveni(), introStateOf(templateIds));
}

/** Notun okunmuş taramalarının TÜM bölge şablon kodları (yalnız JSON alt yolu çekilir). */
async function noteRegionTemplateIds(noteId: string): Promise<Array<string | null>> {
  const rows = await prisma.$queryRaw<Array<{ ids: unknown }>>(Prisma.sql`
    SELECT jsonb_path_query_array("ocrResult"->'regions', '$[*].templateId') AS ids FROM "document_scans"
    WHERE "noteId" = ${noteId}::uuid AND "status" = 'READ' AND "ocrResult" IS NOT NULL
    ORDER BY "pageNo" ASC, "regionNo" ASC NULLS FIRST, "createdAt" ASC`);
  return rows.flatMap((r) => (Array.isArray(r.ids) ? r.ids.map((x) => (typeof x === "string" ? x : null)) : []));
}

/** Notun tanıtım durumu (okunmuş taramaların bölgelerinden; SOR/SORMA ayarından bağımsız). */
export async function noteIntroState(noteId: string): Promise<IntroState> {
  return introStateOf(await noteRegionTemplateIds(noteId));
}

/** Kullanıcı şablonunun adı (şablon JSON'unda); bulunamazsa kod. */
async function userTemplateName(code: string): Promise<string> {
  const row = await prisma.senderTemplate.findUnique({ where: { code }, select: { template: true } });
  const name = (row?.template as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? name : code;
}

/** Okuma özeti: `tanitim` (yoksa undefined — alan yanıta konmaz) + güven kipi. */
export async function noteTanitim(noteId: string): Promise<{ tanitim: TanitimInfo | undefined; trust: TrustMode }> {
  const st = await noteIntroState(noteId);
  const trust = trustModeOf(await readTanitimGuveni(), st);
  if (!st) return { tanitim: undefined, trust };
  if (st.durum === "TANITILMAMIS") return { tanitim: st, trust };
  // Kullanıcı şablonu önbelleği süreç açılışında dolmaz (ilk okumada dolar) — sorusuz türetim şablonu görmeli.
  if (trust === "TRUSTED" && !templateByCode(st.sablonKodu)) await loadUserTemplates();
  return { tanitim: { ...st, sablonAdi: await userTemplateName(st.sablonKodu) }, trust };
}
