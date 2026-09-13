// =============================================================================
// CIRCIR KOLU — çürüme kolunun (gerçek < taban) commit kapısında UYARIYA düşmesi
// =============================================================================
// ⭐ NEDEN VAR (2026-09-13, 1e hükmü): cırcır sabitini yalnız entegratör yazar
//    (trende, birleşik index'te ölçerek). Commit kapısının 5. adımı cırcırları
//    izole ağaçta koşunca şu doğdu: 01 on üç kesik alanı KAPATTI → gerçek 0,
//    sabit 13 → "taban ÇÜRÜMEMİŞ" kırmızı → sabiti 01 yazamaz → 01'in SONRAKİ
//    HİÇBİR commit'i geçmez. *Doğru davranışı pahalılaştıran kapı* — kapının
//    ölüm biçimlerinden biri: borcu ödeyen cezalandırılır.
//
// KURAL: cırcırın İKİ kolu var ve aynı yerde aynı sertlikte değil:
//    ARTIŞ  (gerçek > taban) — HER yerde sert: ihlal eklendi.
//    ÇÜRÜME (gerçek < taban) — commit kapısında ⚠️ UYARI (basılır, çıkış 0);
//                              CI ve tren koşumunda SERT kalır (sabit orada düşer).
//    Ayrım env'den: `hizli-mandallar.mjs` çocuk sürece `TEKSERP_KAPI_ADIMI=commit`
//    verir; env yoksa (CI, `npm test`, elle koşum) bugünkü davranış — sert.
//
// ⚠️ Bu bir kaçış DEĞİLDİR: uyarı basılır, sabit yine trende düşer; gevşeyen
//    şey yalnız "kim, ne zaman" — sabiti yazma yetkisi olmayan oturum, sabitin
//    düşmesi gereken anda commit atabilir.
// =============================================================================

/** Commit kapısı koşumu mu — `hizli-mandallar.mjs` çocuk sürece verir. */
export function commitKapisiMi(): boolean {
  return process.env.TEKSERP_KAPI_ADIMI === "commit";
}

/**
 * Çürüme kolu kontrolü. Commit kapısında gerçek < taban ise `check`i ÇAĞIRMAZ ve
 * bunu ATLAMA DEFTERİNE yazar (⏭ satırı + Sonuç'ta ", 1 atlandı") — CI ile commit
 * arasındaki bir kontrol farkı ADLI olsun, sessiz olmasın. Aksi hâlde sert `check`.
 */
export function curumeKolu(
  check: (label: string, ok: boolean, detay?: string) => void,
  atla: (label: string, sebep: string) => void,
  label: string,
  gercek: number,
  taban: number,
): void {
  if (commitKapisiMi() && gercek < taban) {
    atla(
      label,
      `⚠️ uyarıya düştü (commit kapısı kipi): taban ${taban} > gerçek ${gercek} — entegratör trende düşürür, CI'da sert`,
    );
    return;
  }
  check(label, gercek >= taban, `gerçek ${gercek} · taban ${taban}`);
}
