// Davet belirteci YALNIZ ilk yanıtta gelir: bir kez gösterilir, depoya yazılmaz.
import { Text, View } from "react-native";
import type { AccountInviteResult } from "../api/wire";
import { formatDateTime } from "../lib/format";
import { Banner, Body, Card, Muted } from "./kit";

export function InviteShown({ r }: { r: AccountInviteResult }) {
  return (
    <Card>
      {r.davet ? (
        <View>
          <Body>Davet kodunu hesabın sahibine güvenli bir yoldan iletin (bir kez gösterilir):</Body>
          <Text selectable style={{ fontSize: 16, fontWeight: "700", marginVertical: 8 }} testID="davet-kodu">{r.davet}</Text>
        </View>
      ) : (
        <Banner tone="warn" text="Davet kodu yalnız ilk yanıtta gösterilir; yeni kod için daveti yenileyin." />
      )}
      <Muted>{`Geçerlilik: ${formatDateTime(r.davetBitis)}`}</Muted>
    </Card>
  );
}
