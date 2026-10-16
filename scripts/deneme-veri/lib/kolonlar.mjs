// =============================================================================
// deneme-veri — kolon ROLÜ (anonimleştirmede bir kolona ne yapılır) ve bulut kataloğu okuyucusu.
// Rol kolon ADI ve tipinden türetilir (şema sözleşmesi); değer tahmini yapılmaz. Bekçi: scripts/test_deneme_veri.mjs.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kisiselKolonTuru } from "./anonim.mjs";

export const KULLANICI_DESENI = /^as\.(del_[0-9a-f]{6}_)?kullanici\d+$/;
export const CIHAZ_DESENI = /^as\. (Tablet|Masaüstü|Cihaz) \d{2}$/;

/** Yapılandırma KATALOĞU tabloları: metinleri kurulumun tanımıdır, serbest not değildir → yalnız ad sözlüğü uygulanır. */
export const KATALOG_TABLOLARI = new Set([
  "reason_presets", "permissions", "permission_templates", "permission_template_items", "number_series", "number_series_lines",
  "return_reasons", "defect_types", "subcontractor_categories", "routes", "route_steps", "stations", "items", "colors",
  "quality_grades", "fabric_properties", "fabric_property_values", "label_templates", "label_template_variants",
  "traveler_card_templates", "document_profiles", "warehouses", "machines", "machine_specs", "shift_definitions", "system_settings",
]);
/** Kullanıcının elle yazdığı ETİKET adları (benzersiz olabilir → değişen değere sıra no eklenir). */
export const ETIKET_KOLONLARI = new Set(["packing_groups.name", "sack_tags.name"]);

const METIN_TIPLERI = new Set(["text", "character varying"]);
const JSON_TIPLERI = new Set(["jsonb", "json"]);
/** Kimlik/kod/numara/sır kolonları — anonimleştirme DOKUNMAZ (numara serileri ve belge numaraları değişmez). */
export const DOKUNULMAZ = /^(id|code|barcode|prefix|key|separator|hex|unit|currency|status|type|kind|username)$|Id$|Code$|No$|Number$|Hash$|Digest$|Token$|Secret$|Seal$|Fold$|Key$|Ids$|^quickPin$|^cardToken|^totp/;
const SERBEST = /(^|[a-z])(notes?|Notes?|description|Description|reason|Reason|reasonText|ReasonText|instruction|Instruction|comment|Comment|remark|Remark|memo|Memo)$/;

/** Kolonun anonimleştirme rolü ya da null (dokunulmaz). */
export function kolonRolu(tablo, k, dokunulmaz = DOKUNULMAZ) {
  if (k.gen === "ALWAYS") return null; // GENERATED (nameFold …) kendiliğinden yeniden hesaplanır
  const metin = METIN_TIPLERI.has(k.tip), json = JSON_TIPLERI.has(k.tip);
  if (!metin && !json) return null;
  if (json) return "JSON";
  if (tablo === "users") return k.c === "username" ? "KULLANICI_ADI" : k.c === "fullName" ? "AD" : null;
  if (tablo === "devices") return k.c === "name" ? "CIHAZ_ADI" : null;
  if (tablo === "subcontractors" && k.c === "code") return "ESKI_KOD";
  if (kisiselKolonTuru(k.c)) return "KISISEL";
  if (dokunulmaz.test(k.c)) return null;
  if (ETIKET_KOLONLARI.has(`${tablo}.${k.c}`)) return "ETIKET";
  if (!KATALOG_TABLOLARI.has(tablo) && SERBEST.test(k.c)) return "SERBEST";
  return "METIN";
}

/**
 * Bulut projeksiyon kataloğu (Teks-Erp/src/cloud-sync/projections.ts + catalog-facts.ts): kök tablo → buluta
 * giden DB kolonları. Kaynak metinden okunur; beklenen kökler bulunamazsa DUR (ayrıştırma bayat).
 */
export function projeksiyonKolonlari(kok) {
  const out = new Map();
  for (const f of ["Teks-Erp/src/cloud-sync/projections.ts", "Teks-Erp/src/cloud-sync/catalog-facts.ts"]) {
    const metin = readFileSync(join(kok, f), "utf8");
    const parcalar = metin.split(/\n\s*\{\s*\n\s*name: "/).slice(1);
    for (const p of parcalar) {
      const kokTablo = /root: \{ table: "(\w+)"/.exec(p)?.[1];
      if (!kokTablo) continue;
      const kolon = [...p.matchAll(/col\("[^"]+", "(\w+)"/g)].map((m) => m[1]);
      if (!out.has(kokTablo)) out.set(kokTablo, new Set());
      for (const c of kolon) out.get(kokTablo).add(c);
    }
  }
  for (const zorunlu of ["customers", "subcontractors", "cheques", "orders", "shipments"]) {
    if (!out.get(zorunlu)?.size) throw new Error(`bulut kataloğunda '${zorunlu}' kökü okunamadı — ayrıştırma bayat`);
  }
  return out;
}
