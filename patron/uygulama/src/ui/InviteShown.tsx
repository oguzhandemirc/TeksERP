// Davet belirteci YALNIZ ilk yanıtta gelir: bir kez gösterilir, depoya yazılmaz.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import type { AccountInviteResult } from "../api/wire";
import { formatDateTime } from "../lib/format";
import { Banner, Card } from "./kit";
import { makeStyles, useTokens } from "./theme-context";
import { radius, space, typography } from "./tokens";

export function InviteShown({ r }: { r: AccountInviteResult }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Card domain="gelenKutusu">
      {r.davet ? (
        <View>
          <Text style={s.lead}>Davet kodunu hesabın sahibine güvenli bir yoldan iletin (bir kez gösterilir):</Text>
          <View style={[s.box, { backgroundColor: t.surfaceAlt, borderColor: t.separator }]}>
            <Ionicons name="mail-open-outline" size={20} color={t.tint} />
            <Text selectable style={s.code} testID="davet-kodu">{r.davet}</Text>
          </View>
          <Text style={s.hint}>Kodu seçip kopyalayabilirsiniz; bu ekrandan çıkınca yeniden gösterilmez.</Text>
        </View>
      ) : (
        <Banner tone="warn" text="Davet kodu yalnız ilk yanıtta gösterilir; yeni kod için daveti yenileyin." />
      )}
      <View style={s.until}>
        <Ionicons name="time-outline" size={16} color={t.textMuted} />
        <Text style={s.hint}>{`Geçerlilik: ${formatDateTime(r.davetBitis)}`}</Text>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  lead: { ...typography.body, color: t.text },
  box: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, borderWidth: 1, borderRadius: radius.cardInner, padding: space.m, marginVertical: space.m },
  code: { ...typography.headline, fontSize: 18, letterSpacing: 1, color: t.text, flex: 1 },
  hint: { ...typography.footnote, color: t.textMuted },
  until: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, marginTop: space.s },
}));
