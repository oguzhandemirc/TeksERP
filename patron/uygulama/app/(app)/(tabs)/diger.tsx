// "Diğer" sekmesi: üstte hesap kartı (→ Profil), sonra sekmeye sığmayan bölümler gruplu liste (İş · Eylem · Hesap).
// İzinsiz bölüm/grup çizilmez. Gelen kutusu satırında bekleyen talep sayısı (sunucu `durum=BEKLIYOR` süzgeciyle).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { MODULES, moduleDef, moduleNavTitle, moduleVisible } from "../../../src/lib/access";
import { yetenek } from "../../../src/api/yetenek";
import { okunmamisRozeti } from "../../../src/lib/erp-bildirim";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { BILDIRIM_TAG } from "../../../src/ui/bildirim/GelenBildirimler";
import { Avatar, CountPill } from "../../../src/ui/diger/parts";
import { FacilityName, Screen } from "../../../src/ui/Frame";
import { MODULE_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { RoleBadge } from "../../../src/ui/RoleBadge";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { MORE_GROUPS } from "../../../src/ui/tabs";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { radius, space, typography } from "../../../src/ui/tokens";


const INBOX_BADGE_LIMIT = 50;

export default function More() {
  const { api, permissions, facility, bildirimci } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const inboxOn = moduleVisible(permissions, "gelen-kutusu");
  // Liste ekranının "Bekleyen" süzgeciyle AYNI anahtar ve istek: tek önbellek kaydı, tek etiket.
  const pending = useRemote(inboxOn ? "gelen-kutusu:BEKLIYOR" : null, () => api.inboxList({ durum: "BEKLIYOR", limit: INBOX_BADGE_LIMIT }), { tags: ["gelen-kutusu"] });
  const count = pending.data ? pending.data.kayitlar.length : 0;
  const badge = count > 0 ? `${count}${pending.data?.sonraki ? "+" : ""}` : null;
  // ERP gelen kutusu: okunmamış sayısı — bildirim ekranıyla AYNI anahtar ve etiket (okundu sayınca birlikte tazelenir).
  const notifyOn = yetenek().bildirimKutusu && moduleVisible(permissions, "bildirimler");
  const ozet = useRemote(notifyOn ? "bildirim-ozet" : null, () => bildirimci.ozet(), { tags: [BILDIRIM_TAG] });
  const unread = notifyOn ? okunmamisRozeti(ozet.data?.okunmamis) : null;
  const pill = (key: string) => (key === "gelen-kutusu" ? badge : key === "bildirimler" ? unread : null);
  const hesap = facility?.hesap;

  return (
    <Screen title="Diğer" back={false} subtitle={<FacilityName />} onRefresh={inboxOn ? pending.reload : undefined} refreshing={pending.refreshing}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Profil: ${hesap?.ad ?? ""}`}
        onPress={() => router.push("/profil" as never)}
        style={({ pressed }) => [s.account, pressed && { backgroundColor: t.surfaceAlt }]}
        testID="diger-hesap"
      >
        <Avatar name={hesap?.ad} permissions={permissions} size={52} />
        <View style={s.flex}>
          <Text style={s.name} numberOfLines={1}>{hesap?.ad ?? "Hesabım"}</Text>
          {hesap?.eposta ? <Text style={s.mail} numberOfLines={1}>{hesap.eposta}</Text> : null}
          <View style={s.badgeRow}><RoleBadge permissions={permissions} testID="diger-rol" /></View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
      </Pressable>
      {MORE_GROUPS.map((g) => {
        const mods = g.modules.filter((k) => moduleVisible(permissions, k)).map((k) => MODULES.find((m) => m.key === k)!);
        if (mods.length === 0) return null;
        return [
          <SectionHeader key={`${g.title}-h`} title={g.title} />,
          <ListGroup key={g.title} testID={`grup-${g.title}`}>
            {mods.map((m) => (
              <ListRow
                key={m.key}
                title={moduleNavTitle(m.key)}
                subtitle={moduleDef(m.key).hint}
                domain={MODULE_ICON[m.key].domain}
                icon={MODULE_ICON[m.key].icon}
                accessory={pill(m.key) ? <CountPill value={pill(m.key)!} testID={m.key === "gelen-kutusu" ? "gelen-rozet" : "bildirim-rozet"} /> : undefined}
                accessibilityLabel={pill(m.key) ? `${moduleNavTitle(m.key)}, ${pill(m.key)!} ${m.key === "gelen-kutusu" ? "bekleyen talep" : "okunmamış bildirim"}` : undefined}
                onPress={() => router.push(m.route as never)}
                testID={`menu-${m.key}`}
              />
            ))}
          </ListGroup>,
        ];
      })}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  account: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.m,
    padding: space.l,
    backgroundColor: t.surface,
    borderRadius: radius.card,
    marginTop: space.s,
    ...t.cardShadow,
  },
  flex: { flex: 1 },
  name: { ...typography.title3, color: t.text },
  mail: { ...typography.subhead, color: t.textSecondary, marginTop: 1 },
  badgeRow: { marginTop: space.xs },
}));
