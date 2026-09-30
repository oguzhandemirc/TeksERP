// LİSTE ARAMASI — terim JS'te, kolon SQL'de AYNI katlamayla karşılaştırılır: Türkçe harf tablosu
// (`translate`) + YALNIZ ASCII küçültme (`COLLATE "C"`: ortamın yerel ayarından bağımsız). İki taraf
// ayrışırsa arama sessizce boş döner; eşitliği `test_liste_arama` canlı DB'ye karşı ölçer.
// LIKE joker karakterleri (`%`, `_`) ve kaçış karakteri terimde kaçırılır: kullanıcı deseni yazamaz.
import { Prisma } from "@prisma/client";

export const FOLD_FROM = "ÇĞİIÖŞÜÂÎÛçğıöşüâîû";
export const FOLD_TO = "cgiiosuaiucgiosuaiu";
const LIKE_ESCAPE = "!";

const FOLD_MAP: ReadonlyMap<string, string> = new Map([...FOLD_FROM].map((ch, i) => [ch, FOLD_TO[i]!]));

/** SQL `lower(translate(x, FROM, TO) COLLATE "C")` ile birebir. */
export function foldTerm(term: string): string {
  let out = "";
  for (const ch of term) {
    const m = FOLD_MAP.get(ch) ?? ch;
    out += m >= "A" && m <= "Z" ? m.toLowerCase() : m;
  }
  return out;
}

/** Katlanmış terimden `%…%` parça deseni; joker ve kaçış karakteri kaçırılır. */
export function likePattern(term: string): string {
  return `%${foldTerm(term).replace(/[!%_]/g, (c) => LIKE_ESCAPE + c)}%`;
}

/** Katlanmış SQL ifadesi (kolon ya da parametre). */
export function foldSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(translate(${expr}, ${FOLD_FROM}, ${FOLD_TO}) COLLATE "C")`;
}

/** `r.data` jsonb alanlarından en az biri terimi içerir. Alan adları katalogdan gelir, yine de parametredir. */
export function searchCondition(fields: readonly string[], term: string): Prisma.Sql {
  const pattern = likePattern(term);
  const parts = fields.map((f) => Prisma.sql`${foldSql(Prisma.sql`(r.data->>${f})`)} LIKE ${pattern} ESCAPE '!'`);
  return Prisma.sql`AND (${Prisma.join(parts, " OR ")})`;
}
