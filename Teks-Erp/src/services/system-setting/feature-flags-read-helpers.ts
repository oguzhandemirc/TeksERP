// Saf parçalar — önbellek durumu (`featureFlagsCache`, `cacheGeneration`) TEK sahibinde,
// `feature-flags-read.ts`te kalır; burada modül düzeyi durum yoktur.
import { terimDokumaAyarla } from "../../constants/terim";
import type prisma from "../../lib/prisma";
import { SETTING_KEYS } from "./keys";
import type { FeatureFlags } from "./feature-flags-types";

/** K20: iş emri adı rejimi (`TERIM.terbiyeIsEmri`) etkin dokumadan — üretim ∧ dokuma ∧ lisans tavanı açık. */
export function applyTermRegime(flags: FeatureFlags): FeatureFlags {
  const licenseClosed = flags.license?.kapaliModuller?.some((m) => m.anahtar === SETTING_KEYS.DOKUMA_ENABLED) ?? false;
  terimDokumaAyarla(flags.productionEnabled && flags.dokumaEnabled && !licenseClosed);
  return flags;
}

/** Tek `findMany`in sonucunu reader'lara enjekte edilen bellek-içi istemciye çevirir (key/parse/default reader'da kalır). */
export function settingMapClient(valueByKey: Map<string, unknown>): Pick<typeof prisma, "systemSetting"> {
  return {
    systemSetting: {
      findUnique: (args: { where: { key: string } }) =>
        Promise.resolve(valueByKey.has(args.where.key) ? { value: valueByKey.get(args.where.key) } : null),
    },
  } as unknown as Pick<typeof prisma, "systemSetting">;
}
