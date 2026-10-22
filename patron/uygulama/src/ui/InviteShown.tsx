// Davet belirteci YALNIZ ilk yanıtta gelir: bir kez gösterilir, depoya yazılmaz.
import { Text, View } from "react-native";
import type { AccountInviteResult } from "../api/wire";
import { formatDateTime } from "../lib/format";
import { Banner, Body, Card, Muted } from "./kit";
import { useTokens } from "./theme-context";

export function InviteShown({ r }: { r: AccountInviteResult }) {
  const t = useTokens();
  return (
    <Card>
      {r.davet ? (
        <View>
          <Body>Davet kodunu hesabın sahibine güvenli bir yoldan iletin (bir kez gösterilir):</Body>
          <Text selectable style={{ fontSize: 16, fontWeight: "700", marginVertical: 8, color: t.text }} testID="davet-kodu">{r.davet}</Text>
        </View>
      ) : (
        <Banner tone="warn" text="Davet kodu yalnız ilk yanıtta gösterilir; yeni kod için daveti yenileyin." />
      )}
      <Muted>{`Geçerlilik: ${formatDateTime(r.davetBitis)}`}</Muted>
    </Card>
  );
}
