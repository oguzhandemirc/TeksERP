// =============================================================================
// DURUŞ SEBEPLERİ — görsel sözlük + hedef müdahale süreleri
// =============================================================================
// Kod, etiket ve kayıp sınıfı sunucu kataloğunun (`MACHINE_STOP_REASONS`) aynası.
// `targetMin` ve `ESCALATION_SETTINGS` MOCK ayar verisidir: gerçekte hedef süreyi
// yönetici panelde sebep satırına yazar, kodda sabit kalmaz (DOKUMA-CANLI-EKRAN.md §5.2, §8).
// =============================================================================
import {
  CalendarClock,
  CircleHelp,
  ClipboardX,
  Coffee,
  Cylinder,
  Grid3x3,
  Palette,
  Power,
  Repeat,
  Rows3,
  Scissors,
  Scroll,
  Shuffle,
  Spool,
  SprayCan,
  UserX,
  Wind,
  Wrench,
  Zap,
  ZapOff,
  type LucideIcon,
} from "lucide-react";
import { SelvageBreakIcon, WarpBreakIcon, WeftBreakIcon } from "./ThreadIcons";
import type { LossClass } from "./types";

export type ReasonIcon = LucideIcon | typeof WeftBreakIcon;

export interface StopReason {
  code: string;
  label: string;
  lossClass: LossClass;
  icon: ReasonIcon;
  /** Hedef müdahale/çözüm süresi (dk); null = süre izlenmez (plan dışı). */
  targetMin: number | null;
}

type Row = readonly [code: string, label: string, lossClass: LossClass, icon: ReasonIcon, targetMin: number | null];
const R = ([code, label, lossClass, icon, targetMin]: Row): StopReason => ({ code, label, lossClass, icon, targetMin });

export const STOP_REASONS: readonly StopReason[] = [
  R(["ATKI_KOPUSU", "Atkı kopuşu", "UNPLANNED", WeftBreakIcon, 5]),
  R(["COZGU_KOPUSU", "Çözgü kopuşu", "UNPLANNED", WarpBreakIcon, 10]),
  R(["KENAR_KOPUSU", "Kenar kopuşu", "UNPLANNED", SelvageBreakIcon, 8]),
  R(["IPLIK_BITTI", "İplik bitti", "UNPLANNED", Spool, 10]),
  R(["MEKANIK_ARIZA", "Mekanik arıza", "UNPLANNED", Wrench, 30]),
  R(["ELEKTRIK_ARIZA", "Elektrik arızası", "UNPLANNED", Zap, 30]),
  R(["ELEKTRIK_KESINTISI", "Elektrik kesintisi", "UNPLANNED", ZapOff, 15]),
  R(["HAVA_BASINCI", "Hava basıncı düştü", "UNPLANNED", Wind, 15]),
  R(["JAKAR_ARIZA", "Jakar arızası", "UNPLANNED", Grid3x3, 30]),
  R(["OPERATOR_YOK", "Operatör yok", "UNPLANNED", UserX, 5]),
  R(["KUMAS_TAMIR", "Kumaş tamiri", "UNPLANNED", Scissors, 15]),
  R(["TESPIT_EDILEMEDI", "Sebep tespit edilemedi", "UNPLANNED", CircleHelp, 10]),
  R(["LEVENT_BAGLAMA", "Levent bağlama", "SETUP", Cylinder, 30]),
  R(["TAHAR", "Tahar", "SETUP", Shuffle, 120]),
  R(["TARAK_DEGISIMI", "Tarak değişimi", "SETUP", Rows3, 30]),
  R(["DESEN_DEGISIMI", "Desen değişimi", "SETUP", Palette, 45]),
  R(["TOP_ALMA", "Top alma", "SETUP", Scroll, 10]),
  R(["PLANLI_BAKIM", "Planlı bakım", "PLANNED", CalendarClock, 60]),
  R(["TEMIZLIK", "Temizlik", "PLANNED", SprayCan, 20]),
  R(["MOLA", "Mola", "PLANNED", Coffee, 30]),
  R(["VARDIYA_DEVRI", "Vardiya devri", "PLANNED", Repeat, 10]),
  R(["SIPARIS_YOK", "Sipariş yok", "NON_SCHEDULED", ClipboardX, null]),
  R(["TEZGAH_KAPALI", "Tezgah kapalı", "NON_SCHEDULED", Power, null]),
];

const BY_CODE = new Map(STOP_REASONS.map((s) => [s.code, s]));

/** Bilinmeyen kod "tespit edilemedi"ye düşer — ekran boş simge çizmez. */
export function reasonOf(code: string): StopReason {
  return BY_CODE.get(code) ?? BY_CODE.get("TESPIT_EDILEMEDI")!;
}

/**
 * Uyarı zinciri ayarı (MOCK profil verisi). `graceMin`: hedef aşıldıktan sonra
 * patrona iletmeden önceki pay; 0 = hedef dolar dolmaz patrona. Fabrika genelinde
 * TEK değerdir, sebep başına değil — sebebin aciliyeti hedef sürededir (belge §8).
 */
export const ESCALATION_SETTINGS: Readonly<{ graceMin: number }> = { graceMin: 0 };
