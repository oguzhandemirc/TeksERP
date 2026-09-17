// =============================================================================
// ROTAYA GİREMEYEN İSTASYON TÜRLERİ — tek yüklem, iki çağıran
// =============================================================================
// Tezgah topun rotasında bir ADIM DEĞİL, kendi varlığı olan bir üretim alanıdır
// (`docs/kurallar/dokuma.md`; top KK1'de doğar, `entrySource=WEAVING`). Ama tablet
// oturumu istasyon tabanlı olduğu için `StationKind.WEAVING` var ve `Station`
// tablosunda oturur — rota şablonu ve iş emri rotası istasyonu id ile aldığı için
// bir WEAVING istasyonu SESSİZCE adım olabilirdi. Bu kapı onu 400 ile durdurur.
//
// İki çağıran: `route.service.validateSteps` (şablon create/replace) ve
// `workorder.service.assertRouteRefsActive` (WO create/replace/update). İkisi de
// istasyonu zaten "var + aktif" diye okuyor; tür kontrolü aynı okumaya binmez,
// AYRI ve ADLI bir yüklemdir ki bekçi (`test_station_kind_weaving`) çağrı YOLUNU
// ölçebilsin.
// =============================================================================
import { StationKind, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

/** Rota şablonuna / iş emri rotasına GİREMEYEN istasyon türleri. WARPING (devere) tezgahın ikizi:
 *  levent kendi varlığı (`WarpBeam`), sarım topun rotasında adım değil. */
export const NON_ROUTABLE_STATION_KINDS: readonly StationKind[] = [StationKind.WEAVING, StationKind.WARPING];

/**
 * Verilen istasyonlardan biri rotaya giremeyen türdeyse 400 `STATION_NOT_ROUTABLE`
 * (istasyon adıyla). Boş liste no-op. Var/aktif kontrolü çağıranındır.
 */
export async function assertStationsRoutable(db: Db, stationIds: readonly string[]): Promise<void> {
  const ids = [...new Set(stationIds.filter((x) => typeof x === "string" && x.length > 0))];
  if (ids.length === 0) return;
  const blocked = await db.station.findMany({
    where: { id: { in: ids }, kind: { in: [...NON_ROUTABLE_STATION_KINDS] } },
    select: { id: true, code: true, name: true, kind: true },
  });
  if (blocked.length === 0) return;
  throw AppError.badRequest(
    `Rotaya giremeyen istasyon türü: ${blocked.map((s) => `${s.name} (${s.kind})`).join(", ")} — ` +
      "tezgah ve devere topun rotasında bir adım değildir; dokuma işi, koşum ve levent ayrı yaşar.",
    { code: "STATION_NOT_ROUTABLE", stationIds: blocked.map((s) => s.id), kinds: blocked.map((s) => s.kind) },
  );
}
