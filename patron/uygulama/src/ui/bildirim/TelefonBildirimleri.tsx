// ERP Bildirimler ekranının "Telefon bildirimleri" bölümü (push köprüsü P4): bu telefonun izni + açık "Telefon
// bildirimlerini aç" eylemi (izin YALNIZ burada istenir) + tür başına "Telefon bildirimi" anahtarı. Yalnız yetenek
// `patronPush` ∧ derleme kapısı ∧ telefonda çizilir. Anahtar yalnız (tür, PATRON_PUSH) hücresini yazar; varsayılanı sunucu verir.
// S0: üç hazır düğme (Hepsini aç · Yalnız önemliler · Hepsini kapat) + departman başına aç/kapat aynı tercih ucuyla toplu
// yazar (yeni uç yok); "Ses" bölümü (`TelefonSesi`) izin verilmişken görünür.
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { hazirSecimDegisimi, pushGruplari, pushTercihGovdesiToplu, type HazirSecim, type KatalogTuru, type Tercihler } from "../../api/bildirim";
import { errorMessage } from "../../api/client";
import { yetenek } from "../../api/yetenek";
import { erpBildirimGorunusu } from "../../lib/erp-bildirim";
import { erpPushAcik, erpPushEtkinlestir, erpPushSesDegistir, yerelPortlar, type ErpPushSonucu, type IzinDurumu, type PushPortlari } from "../../push/erp-push";
import type { SesSecimi } from "../../push/sesler";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { GroupCaption, GroupNote, ToggleRow } from "../diger/parts";
import { TelefonSesi } from "./TelefonSesi";
import { Banner, Button } from "../kit";
import { ListGroup } from "../ListRow";
import { SectionHeader } from "../SectionHeader";
import { LoadingSkeleton } from "../StateViews";
import { StatusBadge } from "../StatusBadge";
import { space } from "../tokens";

const SONUC: Readonly<Record<Exclude<ErpPushSonucu["kind"], "KAYITLI">, string>> = {
  KAPALI: "Bu fabrikada telefon bildirimi kapalı.",
  IZIN_YOK: "Bildirim izni verilmedi.",
  REDDEDILDI: "Bildirim izni reddedildi. Telefon ayarlarından bu uygulamanın bildirim iznini açın.",
  DESTEKLENMIYOR: "Bildirim yalnız gerçek cihazda alınabilir (öykünücü değil).",
  YAPILANDIRMA_EKSIK: "Bu uygulama sürümünde telefon bildirimi yapılandırılmamış.",
};

/** Gizli depo eylem anında alınır: ekran modülü yüklenirken yerel depo modülü istenmesin. */
const gizliDepo = () => (require("../../state/store") as typeof import("../../state/store")).secretStore;

export function TelefonBildirimleri({ nativePush, portlar = yerelPortlar, os = Platform.OS }: {
  /** Testte derleme kapısı (verilmezse uygulamanınki). */
  nativePush?: boolean;
  portlar?: () => PushPortlari;
  os?: string;
}) {
  const { server, pushCihazci } = useSession();
  const acik = erpPushAcik(yetenek().patronPush, nativePush, os) && Boolean(server) && Boolean(pushCihazci);
  if (!acik) return null;
  return <Bolum portlar={portlar} />;
}

function Bolum({ portlar }: { portlar: () => PushPortlari }) {
  const { server, pushCihazci, offline } = useSession();
  const cihazci = pushCihazci!;
  const [izin, setIzin] = useState<IzinDurumu | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<{ tone: "off" | "warn" | "error"; text: string } | null>(null);
  const remote = useRemote("push-tercih", async () => {
    const [k, t] = await Promise.all([cihazci.katalog(), cihazci.tercihler()]);
    return { turler: k.turler, tercihler: t };
  });
  const [tercihler, setTercihler] = useState<Tercihler | null>(null);
  useEffect(() => {
    if (remote.data) setTercihler(remote.data.tercihler);
  }, [remote.data]);
  useEffect(() => {
    let alive = true;
    void portlar().izinOku().then((d) => alive && setIzin(d), () => alive && setIzin("DESTEKLENMIYOR"));
    return () => {
      alive = false;
    };
  }, [portlar]);

  const ac = useCallback(async () => {
    if (offline) return setMesaj({ tone: "error", text: "Çevrimdışısınız; değişiklik yapılamaz" });
    setBusy("ac");
    setMesaj(null);
    try {
      const r = await erpPushEtkinlestir({ acik: true, adres: server!, cihazci, store: gizliDepo(), portlar }, { iste: true });
      setIzin(await portlar().izinOku().catch(() => null));
      setMesaj(r.kind === "KAYITLI" ? { tone: "off", text: "Bu telefon bildirim alacak." } : { tone: r.kind === "REDDEDILDI" ? "error" : "warn", text: SONUC[r.kind] });
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [offline, server, cihazci, portlar]);

  /** Tek tür, grup ya da hazır düğme: hepsi aynı tam gövdeli PUT (yalnız değişen PATRON_PUSH hücreleri). */
  const yaz = useCallback(async (anahtar: string, degisen: ReadonlyMap<string, boolean>) => {
    if (!tercihler) return;
    if (offline) return setMesaj({ tone: "error", text: "Çevrimdışısınız; değişiklik yapılamaz" });
    if (degisen.size === 0) return setMesaj({ tone: "off", text: "Zaten bu şekilde." });
    setBusy(anahtar);
    setMesaj(null);
    try {
      setTercihler(await cihazci.tercihYaz(pushTercihGovdesiToplu(tercihler, degisen)));
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [tercihler, offline, cihazci]);
  const degistir = (tur: string, acikMi: boolean) => void yaz(tur, new Map([[tur, acikMi]]));

  const baglam = useCallback(() => ({ acik: true, adres: server!, cihazci, store: gizliDepo(), portlar }), [server, cihazci, portlar]);
  const sesDegistir = useCallback(async (s: SesSecimi) => {
    try {
      const r = await erpPushSesDegistir(baglam(), s);
      setMesaj(r.kind === "KAYITLI" ? { tone: "off", text: "Ses seçildi; bundan sonraki bildirimler bu sesle gelir." } : { tone: "off", text: "Ses seçildi; telefon bildirimlerini açınca geçerli olur." });
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
    }
  }, [baglam]);
  const sesUyari = (err: unknown) => setMesaj({ tone: "warn", text: errorMessage(err) });

  const turler: readonly KatalogTuru[] = remote.data?.turler ?? [];
  const ad = new Map(turler.map((t) => [t.kod, t.ad]));
  const gruplar = tercihler ? pushGruplari(tercihler, turler) : [];
  const hazir = (s: HazirSecim) => tercihler && void yaz(`hazir-${s}`, hazirSecimDegisimi(tercihler, turler, s));
  return (
    <View style={{ marginBottom: space.l }} testID="telefon-bildirimleri">
      <SectionHeader title="Telefon bildirimleri" />
      {izin === "VERILDI" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.s, marginBottom: space.s }}>
          <StatusBadge kind="iyi" label="İzin verildi" size="sm" />
        </View>
      ) : null}
      {izin === "REDDEDILDI" ? (
        <>
          <Banner tone="error" text={SONUC.REDDEDILDI} testID="telefon-izin-reddedildi" />
          <Button label="Telefon ayarlarını aç" icon="settings-outline" tone="plain" onPress={() => void Linking.openSettings().catch(() => undefined)} testID="telefon-izin-ayarlar" />
        </>
      ) : null}
      {izin === "SORULMADI" ? (
        <>
          <GroupNote>Seçtiğiniz bildirimler uygulama kapalıyken de telefonunuza gelir. Bildirim metni kilit ekranında görünebilir.</GroupNote>
          <Button label="Telefon bildirimlerini aç" icon="notifications-outline" busy={busy === "ac"} disabled={offline || busy !== null} onPress={() => void ac()} testID="telefon-bildirim-ac" />
        </>
      ) : null}
      {izin === "VERILDI" ? (
        <Button label="Bu telefonu yeniden kaydet" tone="plain" icon="refresh-outline" busy={busy === "ac"} disabled={offline || busy !== null} onPress={() => void ac()} testID="telefon-bildirim-ac" />
      ) : null}
      {mesaj ? <Banner tone={mesaj.tone} text={mesaj.text} testID="telefon-bildirim-mesaj" /> : null}
      {remote.loading && !tercihler ? <LoadingSkeleton rows={3} /> : null}
      {remote.error && !tercihler ? <Banner tone="warn" text={remote.error} testID="telefon-tercih-hata" /> : null}
      {gruplar.length > 0 ? (
        <>
          <GroupNote>Hangi bildirimler telefonunuza gelsin? Kapalı olanlar yalnız uygulamadaki listede görünür.</GroupNote>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s, marginBottom: space.s }} testID="telefon-hazir">
            <Button label="Hepsini aç" tone="secondary" icon="notifications-outline" busy={busy === "hazir-HEPSI"} disabled={offline || busy !== null} onPress={() => hazir("HEPSI")} testID="telefon-hazir-HEPSI" />
            <Button label="Yalnız önemliler" tone="secondary" icon="star-outline" busy={busy === "hazir-ONEMLI"} disabled={offline || busy !== null} onPress={() => hazir("ONEMLI")} testID="telefon-hazir-ONEMLI" />
            <Button label="Hepsini kapat" tone="secondary" icon="notifications-off-outline" busy={busy === "hazir-HICBIRI"} disabled={offline || busy !== null} onPress={() => hazir("HICBIRI")} testID="telefon-hazir-HICBIRI" />
          </View>
          {gruplar.map((g) => {
            const acikSayi = g.hucreler.filter((h) => h.acik).length;
            return (
              <View key={g.grup} style={{ marginBottom: space.s }}>
                <GroupCaption>{g.grup}</GroupCaption>
                <ListGroup testID={`telefon-grup-${g.grup}`}>
                  <ToggleRow label={`${g.grup} bildirimlerinin hepsi`} hint={`${acikSayi}/${g.hucreler.length} açık`} value={acikSayi === g.hucreler.length}
                    disabled={offline || busy !== null} onChange={(v) => void yaz(`grup-${g.grup}`, new Map(g.hucreler.filter((h) => h.acik !== v).map((h) => [h.tur, v])))}
                    testID={`telefon-grup-ac-${g.grup}`} />
                  {g.hucreler.map((h) => (
                    <ToggleRow key={h.tur} label={ad.get(h.tur) ?? h.tur} value={h.acik} disabled={offline || busy !== null}
                      icon={erpBildirimGorunusu(h.tur).icon} domain={erpBildirimGorunusu(h.tur).domain}
                      onChange={(v) => degistir(h.tur, v)} testID={`telefon-tercih-${h.tur}`} />
                  ))}
                </ListGroup>
              </View>
            );
          })}
        </>
      ) : null}
      {izin === "VERILDI" ? (
        <TelefonSesi store={gizliDepo} disabled={offline} onDegistir={sesDegistir}
          onOnizle={(s, ses) => void portlar().sesiOnizle(s, ses).catch(sesUyari)}
          onAyar={(s, ses) => void portlar().kanalAyariniAc(s, ses).catch(sesUyari)} />
      ) : null}
    </View>
  );
}
