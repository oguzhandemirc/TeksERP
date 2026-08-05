// =============================================================================
// GİRİŞ İSTASYONU ÇÖZÜMÜ — TEK KAYNAK (2026-08-05)
// =============================================================================
// `Roll.entryStationId` topun DOĞDUĞU istasyondur ve bir daha değişmez.
// Sistemde topun doğduğu **12 mantıksal yol** var (9 fiziksel `roll.create`
// noktası); her birinde elde farklı bir bağlam bulunur. Kuralı 12 yere tek tek
// yazmak, zamanla 12 farklı yorum demekti — bu dosya o kuralın TEK yeridir.
//
// -----------------------------------------------------------------------------
// KURAL: ADIM > OTURUM > NULL
// -----------------------------------------------------------------------------
// 1) İŞ EMRİ ADIMI varsa o kazanır (`WorkOrderStep.stationId`, şemada NOT NULL).
//    Adım, işin fiilen nerede yapıldığının yapısal kanıtıdır: kesim hangi Tambur
//    adımındaysa orada olmuştur, fason kabulü hangi adımın makbuzuysa oradadır.
// 2) Adım yoksa AKTİF ÇALIŞMA OTURUMU (`WorkSession.stationId`). KK1 ham girişi
//    ve "Manuel Mod" gibi adımsız doğumlarda tek doğru kaynak budur.
// 3) İkisi de yoksa NULL — ve bu MEŞRUDUR (Electron panelinden giriş).
//
// -----------------------------------------------------------------------------
// ⚠️ NEDEN `Machine.stationId` BU LİSTEDE YOK
// -----------------------------------------------------------------------------
// Cazip görünür (`createdMachineId` zaten damgalanıyor) ama YANLIŞTIR: makine
// canlı bir kayıttır ve panelden başka bir istasyona taşınabilir. O an makine
// üzerinden okunan "giriş istasyonu" GERİYE DÖNÜK DEĞİŞİR — aylar önce girilmiş
// toplar bugün başka bir istasyonda girilmiş görünür. Kolonun var olma sebebi
// tam olarak budur; onu yine türetilmiş bir değerle doldurmak amacı yok eder.
//
// Adım ve oturum ikisi de bu soruna BAĞIŞIKTIR: `WorkOrderStep.stationId`
// rotanın parçasıdır, `WorkSession.stationId` ise oturum açılışında makineden
// türetilip DONDURULUR (bkz. `work-session.service.ts` + şema notu).
//
// -----------------------------------------------------------------------------
// ⚠️ `producedInStepId` DE BİR KAYNAK DEĞİLDİR
// -----------------------------------------------------------------------------
// Doğum izi sanılır ama değildir: `attachRolls` onu iş emrinin İLK adımıyla
// EZER, `detachRolls` NULL'lar. Ölçüldü (dev DB): KK1'den ve panelden girilmiş
// 5 top, `producedInStepId` üzerinden bakılırsa "Boyahane (Fason)"da doğmuş
// görünüyor. Geriye doldurma script'i bu yüzden onu YALNIZ dar bir koşulla
// (entrySource + beklenen istasyon türü) kullanır.
// =============================================================================

/**
 * Giriş istasyonunu çözer. İki kaynağı da opsiyoneldir; hiçbiri yoksa `null`.
 *
 * Çağıran, elinde NE VARSA onu verir — sıralamayı burası bilir. Örnekler:
 *   • KK1 ham giriş        → `{ sessionStationId }` (adım yok)
 *   • Tambur kesim çocuğu  → `{ stepStationId }`    (adım var, kazanır)
 *   • Tambur elle ekleme   → ikisi de (adım kazanır; zaten eşit olmaları
 *                            `STATION_MISMATCH` guard'ıyla garanti)
 */
export function resolveEntryStationId(src: {
  /** İşin yapıldığı `WorkOrderStep`in istasyonu. */
  stepStationId?: string | null;
  /** Aktif çalışma oturumunun (dondurulmuş) istasyonu. */
  sessionStationId?: string | null;
}): string | null {
  return src.stepStationId ?? src.sessionStationId ?? null;
}
