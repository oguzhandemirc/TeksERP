// ERP Bildirimler ekranının "Telefon bildirimleri" bölümü (push köprüsü P4): bu telefonun izni + açık "Telefon
// bildirimlerini aç" eylemi (izin YALNIZ burada istenir) + tür başına "Telefon bildirimi" anahtarı. Yalnız yetenek
// `patronPush` ∧ derleme kapısı ∧ telefonda çizilir. Anahtar yalnız (tür, PATRON_PUSH) hücresini yazar; varsayılanı sunucu verir.
// Profiller (fabrika `tercihler/profiller`, PATRON_PUSH): üstte çip şeridi; eski fabrika (uç yok/hata) → S0'ın üç hazır
// düğmesi (Hepsini aç · Yalnız önemliler · Hepsini kapat) aynı tercih ucuyla toplu yazar. Türler katlanır gruplarda +
// arama (`TurGruplari`); "Ses" bölümü (`TelefonSesi`) izin verilmişken görünür.
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { createAttempt, runAttempt } from "../../api/attempt";
import { hazirSecimDegisimi, pushGruplari, pushTercihGovdesiToplu, type HazirSecim, type KatalogTuru, type ProfilGorunumu, type Tercihler } from "../../api/bildirim";
import { errorMessage } from "../../api/client";
import { yetenek } from "../../api/yetenek";
import { erpPushAcik, erpPushEtkinlestir, erpPushSesDegistir, yerelPortlar, type ErpPushSonucu, type IzinDurumu, type PushPortlari } from "../../push/erp-push";
import type { SesSecimi } from "../../push/sesler";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { GroupNote } from "../diger/parts";
import { ProfilSeridi } from "./ProfilSeridi";
import { TelefonSesi } from "./TelefonSesi";
import { TurGruplari } from "./TurGruplari";
import { Banner, Button } from "../kit";
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

/** Profil görünümü ya da `null` (eski fabrika 404 · ağ/sunucu hatası): şerit gizlenir, üç düğme çizilir. */
async function profilOku(oku: (() => Promise<ProfilGorunumu>) | undefined): Promise<ProfilGorunumu | null> {
  try {
    return oku ? await oku() : null;
  } catch {
    return null;
  }
}

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
    // Profil ucu yoksa (eski fabrika 404) ya da düşerse şerit yerine üç düğme çizilir; liste yine yüklenir.
    const [k, t, pr] = await Promise.all([cihazci.katalog(), cihazci.tercihler(), profilOku(cihazci.profiller)]);
    return { turler: k.turler, tercihler: t, profiller: pr };
  });
  const [tercihler, setTercihler] = useState<Tercihler | null>(null);
  const [profiller, setProfiller] = useState<ProfilGorunumu | null>(null);
  const kayitDenemesi = useRef(createAttempt());
  useEffect(() => {
    if (remote.data) {
      setTercihler(remote.data.tercihler);
      setProfiller(remote.data.profiller);
    }
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
      // Tek tür/grup değişimi etkin profili değiştirebilir (ör. "Özel"e düşer); şerit varsa tazele.
      if (profiller) void profilOku(cihazci.profiller).then((g) => g && setProfiller(g));
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [tercihler, offline, cihazci, profiller]);
  const degistir = (tur: string, acikMi: boolean) => void yaz(tur, new Map([[tur, acikMi]]));

  /** Profil eylemleri ortak kabı: çevrimdışı/meşgul denetimi, hata iletisi, başarıda `true`. */
  const profilEylemi = useCallback(async (anahtar: string, fn: () => Promise<void>): Promise<boolean> => {
    if (offline) {
      setMesaj({ tone: "error", text: "Çevrimdışısınız; değişiklik yapılamaz" });
      return false;
    }
    setBusy(anahtar);
    setMesaj(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [offline]);
  const uygula = (secim: { hazir: string } | { kisisel: string }, anahtar: string) => void profilEylemi(anahtar, async () => {
    const r = await cihazci.profilUygula(secim);
    setTercihler({ hucreler: r.hucreler, satirlar: r.satirlar });
    setProfiller(r.profiller);
  });
  const profilKaydet = (ad: string) => profilEylemi("profil-ad", async () => {
    setProfiller((await runAttempt(kayitDenemesi.current, (token) => cihazci.profilKaydet(ad, token))).profiller);
    setMesaj({ tone: "off", text: `“${ad}” profili kaydedildi.` });
  });
  const profilGuncelle = (id: string, b: { ad?: string; seciminiGuncelle?: boolean }) =>
    profilEylemi(b.seciminiGuncelle ? "profil-guncelle" : "profil-ad", async () => setProfiller((await cihazci.profilGuncelle(id, b)).profiller));
  const profilSil = (id: string) => profilEylemi("profil-sil", async () => setProfiller(await cihazci.profilSil(id)));

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
  const ad: ReadonlyMap<string, string> = new Map(turler.map((t) => [t.kod, t.ad]));
  const gruplar = tercihler ? pushGruplari(tercihler, turler) : [];
  const kilit = offline || busy !== null;
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
          {profiller ? (
            <ProfilSeridi gorunum={profiller} busy={busy} disabled={offline} onUygula={uygula} onKaydet={profilKaydet} onGuncelle={profilGuncelle} onSil={profilSil} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s, marginBottom: space.s }} testID="telefon-hazir">
              <Button label="Hepsini aç" tone="secondary" icon="notifications-outline" busy={busy === "hazir-HEPSI"} disabled={kilit} onPress={() => hazir("HEPSI")} testID="telefon-hazir-HEPSI" />
              <Button label="Yalnız önemliler" tone="secondary" icon="star-outline" busy={busy === "hazir-ONEMLI"} disabled={kilit} onPress={() => hazir("ONEMLI")} testID="telefon-hazir-ONEMLI" />
              <Button label="Hepsini kapat" tone="secondary" icon="notifications-off-outline" busy={busy === "hazir-HICBIRI"} disabled={kilit} onPress={() => hazir("HICBIRI")} testID="telefon-hazir-HICBIRI" />
            </View>
          )}
          <TurGruplari gruplar={gruplar} ad={ad} disabled={kilit} onTur={degistir}
            onGrup={(g, v) => void yaz(`grup-${g.grup}`, new Map(g.hucreler.filter((h) => h.acik !== v).map((h) => [h.tur, v])))} />
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
