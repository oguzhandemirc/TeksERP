// =============================================================================
// SATICI CLI'si YÖNETİCİ KAPISI BEKÇİSİ (G19) — satıcı tesiste AKTİF hesap yöneticisi varken yönetici açamaz ya da
// bir hesabı yöneticiye yükseltemez; zorlama yalnız açık bayrak + talep no + gerekçe ile ve denetime yazılır:
//   §1 ilk yönetici: tesiste aktif yönetici yokken `yonetici-davet` zorlamasız geçer (denetim özeti zorlamasız)
//   §2 aktif yönetici varken `yonetici-davet` ve `yonetici-yeniden-davet` 409 AKTIF_YONETICI_VAR · hedef hesap
//      DEĞİŞMEZ (durum, izin, oturum) · tek aktif yönetici hedefin kendisiyse de zorlama ister
//   §3 zorlama: bayrak çözücü (`--zorla` talep + gerekçe ister; bayraksız talep/gerekçe RED) · geçerli zorlama hesabı
//      DAVETLİ + yönetici yapar, oturumu kapatır · denetim satırı talep + gerekçe + aktif yönetici sayısını taşır
//   §4 kurtarma: aktif yönetici yokken (yönetici kilitli) zorlamasız yeniden davet geçer · arşivdeki hesap 409
// Koşum: npx tsx scripts/test_yonetici_kurtarma.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { CloudError } from "../src/lib/errors";
import { withTesis } from "../src/lib/tenant";
import { inviteFacilityAdmin, overrideFromArgs, reinviteAdmin } from "../src/services/vendor-admin.service";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam } from "./lib/test-ortam";

const ZORLA = { talep: "DST-2026-0042", gerekce: "Müşteri yöneticisi telefonunu kaybetti; yazılı talep alındı" };

async function hata(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "GECTI";
  } catch (err) {
    return err instanceof CloudError ? `${err.status} ${err.code}` : (err as Error).message.slice(0, 80);
  }
}

const hesapOku = (o: Ortam, tesisId: string, id: string) => withTesis(o.goc, { tesisId }, (tx) => tx.account.findUniqueOrThrow({ where: { id } }));
const sonDenetim = (o: Ortam, tesisId: string, event: string, entityId: string) =>
  withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.findFirst({ where: { tesisId, event, entityId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));

async function main(): Promise<void> {
  const o = await ortamKur();
  const t = await tesisKur(o);
  try {
    console.log("\n§1 ilk yönetici (aktif yönetici yok)");
    const ilk = await inviteFacilityAdmin(o.goc, { tesisId: t.tesisId, email: `ilk-${randomUUID().slice(0, 8)}@ornek.test`, name: "İlk Yönetici", validHours: 24 }, o.saat.simdi());
    const ilkIz = await sonDenetim(o, t.tesisId, "YONETICI_DAVET", ilk.accountId);
    kontrol("§1a aktif yönetici yokken zorlamasız ilk yönetici daveti geçer · denetim özeti zorlamasız", typeof ilk.token === "string" && ilkIz !== null && ilkIz.summary === null, JSON.stringify(ilkIz?.summary));

    console.log("\n§2 aktif yönetici varken RED");
    const yon = await hesapKur(o, t.tesisId, ["bulut:hesap:yonet", "bulut:siparis:oku"]);
    const uye = await hesapKur(o, t.tesisId, ["bulut:siparis:oku"]);
    const once = await hesapOku(o, t.tesisId, uye.accountId);
    const davetRed = await hata(() => inviteFacilityAdmin(o.goc, { tesisId: t.tesisId, email: `ikinci-${randomUUID().slice(0, 8)}@ornek.test`, name: "İkinci", validHours: 24 }, o.saat.simdi()));
    const yukseltRed = await hata(() => reinviteAdmin(o.goc, { tesisId: t.tesisId, email: uye.eposta, validHours: 24 }, o.saat.simdi()));
    kontrol("§2a ⭐ aktif yönetici varken `yonetici-davet` → 409 AKTIF_YONETICI_VAR", davetRed === "409 AKTIF_YONETICI_VAR", davetRed);
    kontrol("§2b ⭐ aktif yönetici varken `yonetici-yeniden-davet` (hesap yükseltme) → 409 AKTIF_YONETICI_VAR", yukseltRed === "409 AKTIF_YONETICI_VAR", yukseltRed);
    const sonra = await hesapOku(o, t.tesisId, uye.accountId);
    const oturum = await api(o, "GET", "/api/oturum", { belirtec: uye.belirtec });
    kontrol(
      "§2c reddedilen hedef DEĞİŞMEZ: durum AKTİF · izinler aynı (yönetici değil) · oturum açık",
      sonra.status === "AKTIF" && JSON.stringify(sonra.permissions) === JSON.stringify(once.permissions) && !sonra.permissions.includes("bulut:hesap:yonet") && oturum.status === 200,
    );
    const kendiRed = await hata(() => reinviteAdmin(o.goc, { tesisId: t.tesisId, email: yon.eposta, validHours: 24 }, o.saat.simdi()));
    kontrol("§2d hedef tek aktif yöneticinin kendisi olsa da zorlamasız RED", kendiRed === "409 AKTIF_YONETICI_VAR", kendiRed);

    console.log("\n§3 zorlama: bayrak + talep + gerekçe, denetime yazılır");
    const cozucu = (a: Record<string, string>) => {
      try {
        return JSON.stringify(overrideFromArgs(a) ?? null);
      } catch (err) {
        return (err as CloudError).code;
      }
    };
    kontrol(
      "§3a bayrak çözücü: bayraksız → zorlama yok · `--zorla` talepsiz/gerekçesiz RED · bayraksız talep RED · tam → zorlama",
      cozucu({}) === "null" &&
        cozucu({ zorla: "true" }) === "GOVDE_GECERSIZ" &&
        cozucu({ zorla: "true", talep: "DST-1" }) === "GOVDE_GECERSIZ" &&
        cozucu({ talep: "DST-1", gerekce: "yeterince uzun gerekçe" }) === "GOVDE_GECERSIZ" &&
        cozucu({ zorla: "true", talep: "DST-1", gerekce: "yeterince uzun gerekçe" }) === JSON.stringify({ talep: "DST-1", gerekce: "yeterince uzun gerekçe" }),
    );
    const zorlu = await reinviteAdmin(o.goc, { tesisId: t.tesisId, email: uye.eposta, validHours: 24, zorla: ZORLA }, o.saat.simdi());
    const yukseldi = await hesapOku(o, t.tesisId, uye.accountId);
    const kapandi = await api(o, "GET", "/api/oturum", { belirtec: uye.belirtec });
    kontrol("§3b geçerli zorlama: hesap DAVETLİ + yönetici izni, açık oturum kapanır", typeof zorlu.token === "string" && yukseldi.status === "DAVETLI" && yukseldi.permissions.includes("bulut:hesap:yonet") && kapandi.status === 401);
    const iz = await sonDenetim(o, t.tesisId, "YONETICI_YENIDEN_DAVET", uye.accountId);
    const ozet = iz?.summary as { zorla?: boolean; talep?: string; gerekce?: string; aktifYonetici?: number } | null;
    kontrol(
      "§3c ⭐ denetim satırı (aktör satici-cli) talep + gerekçe + aktif yönetici sayısını taşır; tesis yöneticisi denetim ekranında görür",
      iz?.actor === "satici-cli" && ozet?.zorla === true && ozet.talep === ZORLA.talep && ozet.gerekce === ZORLA.gerekce && (ozet.aktifYonetici ?? 0) >= 1,
      JSON.stringify(ozet),
    );
    const ekran = await api(o, "GET", "/api/hesaplar/denetim", { belirtec: yon.belirtec });
    kontrol("§3d tesis yöneticisinin denetim ekranında zorlama talebi görünür", JSON.stringify(ekran.json).includes(ZORLA.talep));
    const zorluDavet = await inviteFacilityAdmin(o.goc, { tesisId: t.tesisId, email: `zorlu-${randomUUID().slice(0, 8)}@ornek.test`, name: "Zorlu", validHours: 24, zorla: ZORLA }, o.saat.simdi());
    const davetIz = (await sonDenetim(o, t.tesisId, "YONETICI_DAVET", zorluDavet.accountId))?.summary as { talep?: string } | null;
    kontrol("§3e zorlamalı yönetici daveti de talebi denetime yazar", davetIz?.talep === ZORLA.talep);

    console.log("\n§4 kurtarma (aktif yönetici yok)");
    await withTesis(o.goc, { tesisId: t.tesisId }, (tx) => tx.account.updateMany({ where: { tesisId: t.tesisId, status: "AKTIF", permissions: { has: "bulut:hesap:yonet" } }, data: { status: "KILITLI" } }));
    const kurtar = await hata(() => reinviteAdmin(o.goc, { tesisId: t.tesisId, email: yon.eposta, validHours: 24 }, o.saat.simdi()));
    kontrol("§4a bütün yöneticiler kilitliyken zorlamasız yeniden davet GEÇER (kurtarma)", kurtar === "GECTI", kurtar);
    const arsivlik = await hesapKur(o, t.tesisId, ["bulut:siparis:oku"]);
    await withTesis(o.goc, { tesisId: t.tesisId }, (tx) => tx.account.update({ where: { id: arsivlik.accountId }, data: { status: "PASIF", closedAt: new Date() } }));
    const arsivRed = await hata(() => reinviteAdmin(o.goc, { tesisId: t.tesisId, email: arsivlik.eposta, validHours: 24 }, o.saat.simdi()));
    kontrol("§4b arşivdeki hesap yeniden davet edilemez → 409", arsivRed === "409 DURUM_CAKISMASI", arsivRed);
  } finally {
    await temizleTesis(o, t.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
