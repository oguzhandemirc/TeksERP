// Ürün kartı D4b form alanları: kumaş top boyu / asgari sipariş / bakım talimatı · iplik filament / kat / büküm /
// parlaklık · iplik+sarf asgari stok. Sayılar METİN taşınır (Decimal'e float yazılmaz); "" = boş.
import { z } from "zod";
import { acceptNumberAsText } from "@/lib/decimal-form-text";
import type { YarnLuster, YarnTwistDirection } from "./types";

export const TWIST_OPTIONS: Array<{ value: YarnTwistDirection; label: string }> = [
  { value: "S", label: "S büküm" },
  { value: "Z", label: "Z büküm" },
];

export const LUSTER_OPTIONS: Array<{ value: YarnLuster; label: string }> = [
  { value: "BRIGHT", label: "Parlak" },
  { value: "SEMI_DULL", label: "Yarı mat" },
  { value: "FULL_DULL", label: "Mat" },
];

const num = (v: string): number => Number(v.replace(",", "."));

/** Pozitif ondalık metin; `scale` hane, `max` sunucu tavanının altı. */
const decimalText = (label: string, scale: number, max: number) =>
  acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || new RegExp(`^\\d+([.,]\\d{1,${scale}})?$`).test(v), `${label} sayı olmalı (en fazla ${scale} ondalık)`)
      .refine((v) => v === "" || num(v) > 0, `${label} sıfırdan büyük olmalı`)
      .refine((v) => v === "" || num(v) <= max, `${label} çok büyük`),
  );

/** Tam sayı metin; `min`..`max` (sunucu kuralıyla aynı). */
const intText = (label: string, min: number, max: number) =>
  acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+$/.test(v), `${label} tam sayı olmalı`)
      .refine((v) => v === "" || (Number(v) >= min && Number(v) <= max), `${label} ${min}–${max} arasında olmalı`),
  );

export const cardExtraFields = {
  standardRollLengthM: decimalText("Top boyu", 2, 100_000),
  minOrderQty: decimalText("Asgari sipariş", 2, 9_999_999_999),
  careInstructions: z.string().trim().max(500, "Bakım talimatı en fazla 500 karakter olabilir"),
  yarnFilamentCount: intText("Filament sayısı", 1, 100_000),
  yarnPly: intText("Kat", 1, 20),
  yarnTwistTpm: intText("Büküm", 0, 5000),
  yarnTwistDirection: z.union([z.literal(""), z.enum(["S", "Z"])]),
  yarnLuster: z.union([z.literal(""), z.enum(["BRIGHT", "SEMI_DULL", "FULL_DULL"])]),
  minStockQty: decimalText("Asgari stok", 3, 99_999_999_999),
};

export const cardExtraDefaults = {
  standardRollLengthM: "",
  minOrderQty: "",
  careInstructions: "",
  yarnFilamentCount: "",
  yarnPly: "",
  yarnTwistTpm: "",
  yarnTwistDirection: "" as const,
  yarnLuster: "" as const,
  minStockQty: "",
};
