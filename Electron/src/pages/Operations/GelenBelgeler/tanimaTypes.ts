// Tanıma özeti (`tanima`) — backend `gelen-belge-tanima-ozeti.service.ts` aynası; okuma özeti ve belge detayı aynı bloğu döner,
// panel TÜRETMEZ (yalnız çizer). Eski sunucu göndermez → kart çizilmez.
import type { FieldGroup } from "./tanit/fieldTargets";

export type TanimaRuleSource = "TEMPLATE" | "FACTORY" | "MANUAL";

export interface TanimaMappingRow {
  field: string;
  label: string;
  value: string | null;
  woTarget: string;
  woLabel: string;
  group: FieldGroup;
}

export interface TanimaRule {
  key: "multiParty" | "sections" | "totalsRow" | "meterSource";
  value: string;
  source: TanimaRuleSource;
  text: string;
  /** "şablon kuralı" · "fabrika ayarı" · "elle" — ekranda parantez içi. */
  sourceText: string;
}

export interface Tanima {
  template: { code: string; name: string; version: number; score: number | null } | null;
  durum: "TANITILDI" | "SISTEM" | "TANITILMAMIS";
  mapping: TanimaMappingRow[];
  rules: TanimaRule[];
}
