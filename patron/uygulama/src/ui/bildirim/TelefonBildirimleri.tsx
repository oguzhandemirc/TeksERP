// ERP Bildirimler ekranının "Telefon bildirimleri" bölümü (push köprüsü P4): bu telefonun izni + açık "Telefon
// bildirimlerini aç" eylemi (izin YALNIZ burada istenir) + tür başına "Telefon bildirimi" anahtarı. Yalnız yetenek
// `patronPush` ∧ derleme kapısı ∧ telefonda çizilir. Anahtar yalnız (tür, PATRON_PUSH) hücresini yazar; varsayılanı sunucu verir.
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { pushHucreleri, pushTercihGovdesi, type KatalogTuru, type Tercihler } from "../../api/bildirim";
import { errorMessage } from "../../api/client";
import { yetenek } from "../../api/yetenek";
import { erpBildirimGorunusu } from "../../lib/erp-bildirim";
import { erpPushAcik, erpPushEtkinlestir, yerelPortlar, type ErpPushSonucu, type IzinDurumu, type PushPortlari } from "../../push/erp-push";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { GroupNote, ToggleRow } from "../diger/parts";
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

  const degistir = useCallback(async (tur: string, acikMi: boolean) => {
    if (!tercihler) return;
    if (offline) return setMesaj({ tone: "error", text: "Çevrimdışısınız; değişiklik yapılamaz" });
    setBusy(tur);
    setMesaj(null);
    try {
      setTercihler(await cihazci.tercihYaz(pushTercihGovdesi(tercihler, tur, acikMi)));
    } catch (err) {
      setMesaj({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [tercihler, offline, cihazci]);

  const ad = new Map((remote.data?.turler ?? []).map((t: KatalogTuru) => [t.kod, t.ad]));
  const hucreler = tercihler ? pushHucreleri(tercihler) : [];
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
      {hucreler.length > 0 ? (
        <>
          <GroupNote>Hangi bildirimler telefonunuza gelsin? Kapalı olanlar yalnız bu listede görünür.</GroupNote>
          <ListGroup testID="telefon-tercihler">
            {hucreler.map((h) => (
              <ToggleRow key={h.tur} label={ad.get(h.tur) ?? h.tur} value={h.acik} disabled={offline || busy !== null}
                icon={erpBildirimGorunusu(h.tur).icon} domain={erpBildirimGorunusu(h.tur).domain}
                onChange={(v) => void degistir(h.tur, v)} testID={`telefon-tercih-${h.tur}`} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </View>
  );
}
