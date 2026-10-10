// Mock katalog — uydurma kumaşlar, görevliler ve sık duruş ağırlıkları.
// Gerçek kişi adı YOK; adlar örnek amaçlıdır.
import type { LoomType, Person } from "../types";

export const FABRICS: readonly { name: string; color: string }[] = [
  { name: "Poplin 40/1", color: "#2F4A7A" },
  { name: "Gabardin", color: "#6B6A3A" },
  { name: "Keten görünüm", color: "#CDBF9E" },
  { name: "Saten astar", color: "#7A2E3A" },
  { name: "Twill 3/1", color: "#3E5C5A" },
  { name: "Ham bez", color: "#E4DCC8" },
  { name: "Oxford", color: "#8FA7C9" },
  { name: "Panama", color: "#4B4E57" },
];

/** Hol başına görevli (mock; gerçekte vardiya/hol sorumlu ataması). */
export const ATTENDANTS: Readonly<Record<string, Person>> = {
  A: { id: "g-a", name: "Kerem U.", role: "ATTENDANT" },
  B: { id: "g-b", name: "Selin T.", role: "ATTENDANT" },
  C: { id: "g-c", name: "Murat D.", role: "ATTENDANT" },
};

export const OWNER: Person = { id: "p-1", name: "Patron", role: "OWNER" };

/** Holler ve tezgah sayıları — üç hol, 36 tezgah. */
export const HALLS: readonly { name: string; count: number; loomType: LoomType }[] = [
  { name: "A", count: 14, loomType: "AIR_JET" },
  { name: "B", count: 12, loomType: "AIR_JET" },
  { name: "C", count: 10, loomType: "RAPIER" },
];

/** Çalışan tezgahın kendiliğinden durma sebepleri (sahadaki sıklık sırasıyla). */
export const SUDDEN_STOP_WEIGHTS: readonly (readonly [string, number])[] = [
  ["ATKI_KOPUSU", 34],
  ["COZGU_KOPUSU", 15],
  ["KENAR_KOPUSU", 6],
  ["IPLIK_BITTI", 8],
  ["OPERATOR_YOK", 6],
  ["TOP_ALMA", 8],
  ["MEKANIK_ARIZA", 5],
  ["HAVA_BASINCI", 3],
  ["KUMAS_TAMIR", 4],
  ["TESPIT_EDILEMEDI", 4],
  ["ELEKTRIK_ARIZA", 2],
  ["JAKAR_ARIZA", 2],
];

/**
 * Açılışta salonu ilginç kılan duruş senaryoları — her kademe en az bir kez görünür.
 * `ageMin` duruşun yaşı, `respondMin` görevlinin geldiği an (başlangıçtan), null = gelmedi.
 */
export const OPENING_SCENARIOS: readonly { reason: string; ageMin: number; respondMin: number | null }[] = [
  { reason: "ATKI_KOPUSU", ageMin: 2.5, respondMin: null },
  { reason: "ATKI_KOPUSU", ageMin: 6.2, respondMin: null },
  { reason: "COZGU_KOPUSU", ageMin: 14, respondMin: 4 },
  { reason: "OPERATOR_YOK", ageMin: 9.5, respondMin: null },
  { reason: "LEVENT_BAGLAMA", ageMin: 18, respondMin: 1 },
  { reason: "TOP_ALMA", ageMin: 1.5, respondMin: 0.5 },
  { reason: "PLANLI_BAKIM", ageMin: 24, respondMin: 0 },
  { reason: "SIPARIS_YOK", ageMin: 95, respondMin: null },
  { reason: "MEKANIK_ARIZA", ageMin: 8, respondMin: 3 },
  { reason: "TAHAR", ageMin: 72, respondMin: 2 },
];
