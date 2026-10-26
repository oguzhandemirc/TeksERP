// Bildirim Ayarları ekranının alt bölümleri: Cihazlar (bu cihazın izin durumu + kaydet — izin isteme akışı — + kayıtlı
// cihazlar + deneme; ekranın EN ÜSTÜNDE ki izin akışı bulunsun) ve
// Geçmiş (son bildirimler; dokununca yalnız uygulamanın kendi ekranı açılır — `safeRoute`).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import type { Device, TestNotificationResult } from "../api/wire";
import { formatAgo } from "../lib/format";
import { devicePlatform, NOTIFICATION_SKIP, notificationKind } from "../lib/labels/diger";
import { safeRoute } from "../lib/notification-form";
import { permissionView, readPermission, type PermissionState } from "../push/permission";
import { registerThisDevice } from "../push/register";
import { NATIVE_PUSH_SOON, pushAvailable } from "../push/support";
import { useSession } from "../state/session";
import { useRemote } from "../state/useRemote";
import { GroupNote } from "./diger/parts";
import { IconChip } from "./IconChip";
import { Banner, Button } from "./kit";
import { ListGroup, ListRow } from "./ListRow";
import { SectionHeader } from "./SectionHeader";
import { Empty } from "./StateViews";
import { StatusBadge } from "./StatusBadge";
import { makeStyles, useTokens } from "./theme-context";
import { TOUCH, radius, space, typography } from "./tokens";
import { useWrite } from "./useWrite";
import { EMPTY_ICON } from "./icons";

/** Deneme sonucu: kaç cihaza gitti, kayıtsız cihaz çıkarıldı mı. */
export function testOutcome(r: TestNotificationResult): { tone: "off" | "warn"; text: string } {
  const dropped = r.cihazlar.filter((c) => c.sonuc === "GECERSIZ_CIHAZ").length;
  const failed = r.cihazlar.length - r.gonderilen - dropped;
  const parts = [r.gonderilen > 0 ? `Deneme bildirimi ${r.gonderilen} cihaza gönderildi` : "Deneme bildirimi hiçbir cihaza gönderilemedi"];
  if (dropped > 0) parts.push(`${dropped} cihaz artık kayıtlı değil, listeden çıkarıldı`);
  if (failed > 0) parts.push(`${failed} cihaza şu an ulaşılamadı`);
  return { tone: r.gonderilen > 0 && failed + dropped === 0 ? "off" : "warn", text: parts.join(" · ") };
}

/** Kayıtlı cihaz satırı: çıkarma iki adımlıdır (ilk dokunuş sorar). */
function DeviceRow({ d, busy, onRemove }: { readonly d: Device; readonly busy: boolean; readonly onRemove: () => void }) {
  const t = useTokens();
  const s = useStyles();
  const [asking, setAsking] = useState(false);
  const p = devicePlatform(d.platform);
  if (asking) {
    return (
      <View style={[s.ask, { backgroundColor: t.status.kritik.bg }]}>
        <Text style={[s.askText, { color: t.status.kritik.text }]}>Bu cihaza artık bildirim gönderilmesin mi?</Text>
        <View style={s.askRow}>
          <View style={s.flex}><Button label="Vazgeç" tone="plain" onPress={() => setAsking(false)} /></View>
          <View style={s.flex}><Button label="Evet, çıkar" tone="danger" busy={busy} onPress={() => { setAsking(false); onRemove(); }} /></View>
        </View>
      </View>
    );
  }
  return (
    <ListRow
      title={d.ad ?? p.ad}
      subtitle={`${p.ad} · son görülme ${formatAgo(d.sonGorulme)}`}
      icon={p.icon}
      domain="gelenKutusu"
      accessory={
        <Pressable accessibilityRole="button" accessibilityLabel="Bu cihazı çıkar" onPress={() => setAsking(true)} hitSlop={8} style={s.remove}>
          <Text style={[s.removeText, { color: t.status.kritik.fill }]}>Çıkar</Text>
        </Pressable>
      }
    />
  );
}

// `pushHere` yanlışsa (ilk mağaza sürümünde telefon) kayıt düğmesi yerine "yakında" notu çizilir; liste ve deneme kalır.
export function NotificationDevices({ vapidKey, pushHere = pushAvailable(Platform.OS), permission: initial = null, os = Platform.OS }: {
  vapidKey: string | null;
  pushHere?: boolean;
  /** Testte izin durumu (verilirse okunmaz). */
  permission?: PermissionState | null;
  os?: string;
}) {
  const { api } = useSession();
  const t = useTokens();
  const s = useStyles();
  const devices = useRemote("cihazlar", () => api.deviceList());
  const [outcome, setOutcome] = useState<{ tone: "off" | "warn" | "error"; text: string } | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(initial);
  const readState = useCallback(() => {
    if (pushHere) void readPermission(os).then(setPermission).catch(() => setPermission(null));
  }, [pushHere, os]);
  useEffect(() => {
    if (initial === null) readState();
  }, [initial, readState]);
  const view = permission ? permissionView(permission, os) : null;
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
    readState();
  };
  const list = devices.data ?? [];
  return (
    <View>
      <SectionHeader title="Cihazlar" count={devices.data ? list.length : undefined} />
      {pushHere ? (
        <View style={s.here}>
          <IconChip domain="gelenKutusu" icon="phone-portrait-outline" size={40} />
          <View style={s.flex}>
            <View style={s.hereHead}>
              <Text style={s.hereTitle}>Bu cihaz</Text>
              {view ? <StatusBadge kind={view.kind} label={view.label} size="sm" testID="izin-durumu" /> : null}
            </View>
            <Text style={s.hereHint} testID="izin-aciklama">{view?.hint ?? "Bildirim izni istenir; izin verince bildirimler bu cihaza da gelir"}</Text>
          </View>
        </View>
      ) : (
        <View style={s.soon}>
          <View style={[s.soonIcon, { backgroundColor: t.domain.gelenKutusu.chip }]}>
            <Ionicons name="phone-portrait-outline" size={26} color={t.domain.gelenKutusu.fg} />
          </View>
          <Text style={s.soonText} testID="cihaz-yakinda">{NATIVE_PUSH_SOON}</Text>
        </View>
      )}
      {pushHere && view?.action === "ayarlar" && os !== "web" ? (
        <Button label="Telefon ayarlarını aç" icon="settings-outline" onPress={() => void Linking.openSettings().catch(() => undefined)} testID="izin-ayarlar" />
      ) : null}
      {pushHere && view?.action !== "ayarlar" && permission !== "DESTEKLENMIYOR" ? (
        <Button label="Bu cihazda bildirimleri aç" icon="notifications-outline" busy={register.busy} disabled={register.disabled} onPress={() => void onRegister()} testID="cihaz-kaydet" />
      ) : null}
      {register.error ? <Banner tone="error" text={register.error} /> : null}
      {outcome ? <Banner tone={outcome.tone} text={outcome.text} testID="cihaz-sonuc" /> : null}
      {list.length > 0 ? (
        <View style={s.gap}>
          <ListGroup testID="cihaz-listesi">
            {list.map((d) => (
              <DeviceRow key={d.id} d={d} busy={remove.busy && removeId.current === d.id}
                onRemove={() => { removeId.current = d.id; void remove.run(d.id).then(() => devices.reload()); }} />
            ))}
          </ListGroup>
        </View>
      ) : null}
      {remove.error ? <Banner tone="error" text={remove.error} /> : null}
      {list.length > 0 ? (
        <Button label="Deneme bildirimi gönder" tone="plain" icon="paper-plane-outline" busy={test.busy} disabled={test.disabled} onPress={() => void onTest()} testID="bildirim-deneme" />
      ) : null}
      {test.error ? <Banner tone="error" text={test.error} testID="bildirim-deneme-hata" /> : null}
      {devices.data && list.length === 0 && pushHere ? <GroupNote>Kayıtlı cihaz yok; bildirim almak için yukarıdaki düğmeye dokunun.</GroupNote> : null}
    </View>
  );
}

export function NotificationHistory() {
  const { api } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const list = useRemote("bildirimler", () => api.notificationHistory({ limit: 20 }));
  const items = list.data?.kayitlar ?? [];
  return (
    <View>
      <SectionHeader title="Geçmiş" />
      {list.data && items.length === 0 ? <Empty domain="genel" icon={EMPTY_ICON.bildirim} text="Henüz bildirim yok" /> : null}
      {items.length > 0 ? (
        <ListGroup testID="bildirim-gecmisi">
          {items.map((n) => {
            const route = safeRoute(n.rota);
            const look = notificationKind(n.tur);
            const why = n.atlamaNedeni ? NOTIFICATION_SKIP[n.atlamaNedeni] ?? n.atlamaNedeni : null;
            return (
              <Pressable key={n.id} disabled={!route} onPress={() => route && router.push(route as never)} accessibilityRole={route ? "link" : undefined}
                style={({ pressed }) => [s.hist, pressed && route ? { backgroundColor: t.surfaceAlt } : null]}>
                <IconChip domain={look.domain} icon={look.icon} size={36} />
                <View style={s.flex}>
                  <Text style={s.histTitle}>{n.baslik}</Text>
                  <Text style={s.histBody}>{n.metin}</Text>
                  <View style={s.histMeta}>
                    <StatusBadge value={n.durum} size="sm" />
                    <Text style={s.histTime}>{why ? `${formatAgo(n.olusturulma)} · ${why}` : formatAgo(n.olusturulma)}</Text>
                  </View>
                </View>
                {route ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
              </Pressable>
            );
          })}
        </ListGroup>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1, minWidth: 0 },
  gap: { marginTop: space.s },
  here: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, marginBottom: space.s, ...t.cardShadow },
  hereHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, flexWrap: "wrap" as const },
  hereTitle: { ...typography.headline, color: t.text },
  hereHint: { ...typography.footnote, color: t.textSecondary, marginTop: 2 },
  soon: { alignItems: "center" as const, gap: space.m, backgroundColor: t.surface, borderRadius: radius.card, paddingVertical: space.xl, paddingHorizontal: space.l, marginBottom: space.m, ...t.cardShadow },
  soonIcon: { width: 52, height: 52, borderRadius: radius.cardInner + 4, alignItems: "center" as const, justifyContent: "center" as const },
  soonText: { ...typography.callout, color: t.textSecondary, textAlign: "center" as const },
  ask: { padding: space.m, gap: space.s },
  askText: { ...typography.subhead, fontWeight: "600" as const },
  askRow: { flexDirection: "row" as const, gap: space.s },
  remove: { minHeight: TOUCH, justifyContent: "center" as const, paddingHorizontal: space.xs },
  removeText: { ...typography.subhead, fontWeight: "600" as const },
  hist: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  histTitle: { ...typography.headline, color: t.text },
  histBody: { ...typography.subhead, color: t.textSecondary, marginTop: 2 },
  histMeta: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginTop: space.s, flexWrap: "wrap" as const },
  histTime: { ...typography.footnote, color: t.textMuted },
}));
