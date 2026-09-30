// Bildirim ekranının alt bölümleri: bu cihazı kaydet (izin isteme akışı) + kayıtlı cihazlar + son bildirimler.
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TestNotificationResult } from "../api/wire";
import { safeRoute } from "../lib/notification-form";
import { formatDateTime } from "../lib/format";
import { registerThisDevice } from "../push/register";
import { useSession } from "../state/session";
import { useRemote } from "../state/useRemote";
import { Banner, Body, Button, Card, ConfirmButton, Muted, Title } from "./kit";
import { color, space } from "./theme";
import { useWrite } from "./useWrite";

const SKIP_LABEL: Readonly<Record<string, string>> = {
  BILDIRIM_KAPALI: "bildirimler kapalıydı",
  TUR_KAPALI: "tür kapalıydı",
  IZIN_YOK: "yetki yetmedi",
  HESAP_KAPALI: "hesap kapalı",
  CIHAZ_YOK: "kayıtlı cihaz yoktu",
};
const STATUS_LABEL: Readonly<Record<string, string>> = { BEKLIYOR: "Bekliyor", GONDERILIYOR: "Gönderiliyor", GONDERILDI: "Gönderildi", BASARISIZ: "Gönderilemedi", ATLANDI: "Gönderilmedi" };

/** Deneme sonucu: kaç cihaza gitti, kayıtsız cihaz çıkarıldı mı. */
export function testOutcome(r: TestNotificationResult): { tone: "off" | "warn"; text: string } {
  const dropped = r.cihazlar.filter((c) => c.sonuc === "GECERSIZ_CIHAZ").length;
  const failed = r.cihazlar.length - r.gonderilen - dropped;
  const parts = [r.gonderilen > 0 ? `Deneme bildirimi ${r.gonderilen} cihaza gönderildi` : "Deneme bildirimi hiçbir cihaza gönderilemedi"];
  if (dropped > 0) parts.push(`${dropped} cihaz artık kayıtlı değil, listeden çıkarıldı`);
  if (failed > 0) parts.push(`${failed} cihaza şu an ulaşılamadı`);
  return { tone: r.gonderilen > 0 && failed + dropped === 0 ? "off" : "warn", text: parts.join(" · ") };
}

export function NotificationDevices({ vapidKey }: { vapidKey: string | null }) {
  const { api } = useSession();
  const devices = useRemote("cihazlar", () => api.deviceList());
  const [outcome, setOutcome] = useState<{ tone: "off" | "warn" | "error"; text: string } | null>(null);
  const register = useWrite(useCallback(() => registerThisDevice(api, vapidKey), [api, vapidKey]));
  // Hedef cihaz ref'te: aynı dokunuşta yazılıp okunur (state bir sonraki render'a kalır).
  const removeId = useRef<string | null>(null);
  const remove = useWrite(useCallback(() => api.deviceRemove(String(removeId.current)), [api]));
  const test = useWrite(useCallback(() => api.notificationTest(), [api]));
  const onTest = async () => {
    const r = await test.run();
    if (!r) return;
    setOutcome(testOutcome(r));
    devices.reload();
  };
  const onRegister = async () => {
    const r = await register.run();
    if (!r) return;
    setOutcome(r.kind === "KAYITLI" ? { tone: "off", text: "Bu cihaz bildirim alacak" } : { tone: "warn", text: r.message });
    devices.reload();
  };
  return (
    <View style={{ gap: space.m }}>
      <Title>Bu cihaz</Title>
      <Button label="Bu cihazda bildirimleri aç" busy={register.busy} disabled={register.disabled} onPress={() => void onRegister()} testID="cihaz-kaydet" />
      {register.error ? <Banner tone="error" text={register.error} /> : null}
      {outcome ? <Banner tone={outcome.tone} text={outcome.text} testID="cihaz-sonuc" /> : null}
      {(devices.data ?? []).map((d) => (
        <Card key={d.id}>
          <Body>{d.ad ?? d.platform}</Body>
          <Muted>{`${d.platform} · son görülme ${formatDateTime(d.sonGorulme)}`}</Muted>
          <ConfirmButton label="Bu cihazı çıkar" question="Bu cihaza artık bildirim gönderilmesin mi?" busy={remove.busy && removeId.current === d.id}
            onConfirm={() => { removeId.current = d.id; void remove.run(d.id).then(() => devices.reload()); }} />
        </Card>
      ))}
      {devices.data && devices.data.length > 0 ? (
        <Button label="Deneme bildirimi gönder" tone="plain" busy={test.busy} disabled={test.disabled} onPress={() => void onTest()} testID="bildirim-deneme" />
      ) : null}
      {test.error ? <Banner tone="error" text={test.error} testID="bildirim-deneme-hata" /> : null}
      {devices.data && devices.data.length === 0 ? <Muted>Kayıtlı cihaz yok; bildirim almak için yukarıdaki düğmeye dokunun.</Muted> : null}
    </View>
  );
}

export function NotificationHistory() {
  const { api } = useSession();
  const router = useRouter();
  const list = useRemote("bildirimler", () => api.notificationHistory({ limit: 20 }));
  const items = list.data?.kayitlar ?? [];
  return (
    <View style={{ gap: space.s }}>
      <Title>Son bildirimler</Title>
      {items.length === 0 ? <Muted>Henüz bildirim yok.</Muted> : null}
      {items.map((n) => {
        const route = safeRoute(n.rota);
        const why = n.atlamaNedeni ? ` (${SKIP_LABEL[n.atlamaNedeni] ?? n.atlamaNedeni})` : "";
        return (
          <Pressable key={n.id} disabled={!route} onPress={() => route && router.push(route as never)} accessibilityRole={route ? "link" : undefined}>
            <Card>
              <Text style={{ fontSize: 16, fontWeight: "600", color: color.text }}>{n.baslik}</Text>
              <Body>{n.metin}</Body>
              <Muted>{`${formatDateTime(n.olusturulma)} · ${STATUS_LABEL[n.durum] ?? n.durum}${why}`}</Muted>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}
