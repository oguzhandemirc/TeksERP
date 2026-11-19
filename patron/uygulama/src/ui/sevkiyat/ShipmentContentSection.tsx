// Sevkiyat ayrıntısının "Çuval dökümü" bölümü — ayrı kayıt `sevkiyat-icerigi` (fabrikanın sevkiyat ayrıntısıyla aynı, BRÜT:
// iade topu kendi çuvalında rozetli). Küme sunulmuyorsa ya da kayıt yoksa (eski bulut/fabrika 404) bölüm çizilmez.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { kumeSunuluyor } from "../../api/yetenek";
import { can } from "../../lib/access";
import { shipmentContentView } from "../../lib/stok-cuval";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { Card } from "../kit";
import { ListGroup, ListRow } from "../ListRow";
import { SectionHeader } from "../SectionHeader";
import { StatusBadge } from "../StatusBadge";
import { makeStyles } from "../theme-context";
import { space, typography } from "../tokens";

export function ShipmentContentSection({ shipmentId }: { readonly shipmentId: string }) {
  const { api, permissions } = useSession();
  const s = useStyles();
  const enabled = kumeSunuluyor("sevkiyat-icerigi") && can(permissions, "bulut:sevkiyat:oku");
  const r = useRemote(enabled ? `kayit:sevkiyat-icerigi:${shipmentId}` : null, () => api.record("sevkiyat-icerigi", shipmentId));
  const [open, setOpen] = useState<string | null>(null);
  const v = r.data ? shipmentContentView(r.data.kayit) : null;
  if (!v) return null;
  return (
    <>
      <SectionHeader title="Çuval dökümü" domain="sevkiyat" count={v.sacks.length} testID="bolum-cuval-dokumu" />
      <Card domain="sevkiyat" testID="sevk-icerik-ozet">
        <Text style={s.title}>{v.summary}</Text>
        {v.detail ? <Text style={s.line}>{v.detail}</Text> : null}
      </Card>
      {v.sacks.map((c) => (
        <View key={c.key} style={s.sack}>
          <Pressable
            onPress={() => setOpen(open === c.key ? null : c.key)} accessibilityRole="button" accessibilityState={{ expanded: open === c.key }}
            accessibilityLabel={`${c.title}, ${c.line}, ${c.value}`} testID={`sevk-cuval-${c.key}`}
          >
            <ListGroup>
              <ListRow title={c.title} value={c.value} lines={[c.line]} domain="sevkiyat" icon={open === c.key ? "chevron-down" : "chevron-forward"} />
            </ListGroup>
          </Pressable>
          {open === c.key ? (
            <ListGroup testID={`sevk-cuval-toplar-${c.key}`}>
              {c.rolls.map((t) => (
                <ListRow
                  key={t.key} title={t.title} value={t.value} lines={t.lines} domain="sevkiyat"
                  accessory={t.iade ? <StatusBadge kind="uyari" label="İade" size="sm" /> : t.yok ? <StatusBadge kind="kritik" label="Çuvalda değil" size="sm" /> : undefined}
                  testID={`sevk-top-${t.key}`}
                />
              ))}
            </ListGroup>
          ) : null}
        </View>
      ))}
      {v.loose.length > 0 ? (
        <>
          <SectionHeader title="Çuvalsız toplar" domain="sevkiyat" count={v.loose.length} />
          <ListGroup testID="sevk-cuvalsiz">
            {v.loose.map((t) => <ListRow key={t.key} title={t.title} value={t.value} lines={t.lines} domain="sevkiyat" testID={`sevk-top-${t.key}`} />)}
          </ListGroup>
        </>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  title: { ...typography.headline, color: t.text },
  line: { ...typography.body, color: t.textSecondary, marginTop: space.xs },
  sack: { marginBottom: space.xs },
}));
