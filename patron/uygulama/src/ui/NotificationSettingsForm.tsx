// Bildirim ayarları formu (görünüm): ana anahtar ("bildirim yok" dahil), tür başına aç/kapat, sessiz saatler,
// eşikler. İzni yetmeyen tür gösterilir ama açıklanır (sunucu zaten göndermez) — kullanıcı neden gelmediğini bilsin.
import { Switch, Text, View } from "react-native";
import type { NotificationKindInfo } from "../api/wire";
import type { NotificationForm } from "../lib/notification-form";
import { Card, Field, Muted, Title } from "./kit";
import { color, space } from "./theme";

function Toggle(p: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, color: p.disabled ? color.muted : color.text }}>{p.label}</Text>
        {p.hint ? <Text style={{ fontSize: 13, color: color.muted }}>{p.hint}</Text> : null}
      </View>
      <Switch value={p.value} onValueChange={p.onChange} disabled={p.disabled} testID={p.testID} accessibilityLabel={p.label} />
    </View>
  );
}

export function NotificationSettingsForm(p: { form: NotificationForm; kinds: readonly NotificationKindInfo[]; onChange: (f: NotificationForm) => void }) {
  const f = p.form;
  const set = <K extends keyof NotificationForm>(k: K, v: NotificationForm[K]) => p.onChange({ ...f, [k]: v });
  return (
    <View style={{ gap: space.m }}>
      <Card>
        <Toggle label="Bildirimler açık" hint="Kapalıyken hiçbir bildirim gelmez" value={f.acik} onChange={(v) => set("acik", v)} testID="bildirim-ana" />
      </Card>
      <Title>Bildirim türleri</Title>
      <Card>
        {p.kinds.map((k) => (
          <Toggle key={k.tur} label={k.finans ? `${k.ad} (finans)` : k.ad} testID={`tur-${k.tur}`}
            hint={k.izinli ? k.aciklama : "Yetkiniz bu bildirimi almaya yetmiyor"}
            value={f.turler[k.tur]} disabled={!f.acik || !k.izinli}
            onChange={(v) => set("turler", { ...f.turler, [k.tur]: v })} />
        ))}
      </Card>
      <Title>Sessiz saatler</Title>
      <Card>
        <Toggle label="Sessiz saatler" hint="Bu aralıkta doğan bildirim aralık bitince gelir (İstanbul saati)" value={f.sessizAcik} onChange={(v) => set("sessizAcik", v)} disabled={!f.acik} testID="sessiz" />
        {f.sessizAcik ? (
          <View style={{ flexDirection: "row", gap: space.m }}>
            <View style={{ flex: 1 }}><Field label="Başlangıç" value={f.baslangic} onChangeText={(t) => set("baslangic", t.slice(0, 5))} placeholder="22:00" /></View>
            <View style={{ flex: 1 }}><Field label="Bitiş" value={f.bitis} onChangeText={(t) => set("bitis", t.slice(0, 5))} placeholder="07:00" /></View>
          </View>
        ) : null}
      </Card>
      <Title>Eşikler</Title>
      <Muted>Boş bırakılan eşik kapalıdır. Değerler fabrikanın gönderdiği özetle karşılaştırılır.</Muted>
      <Card>
        <Field label="Ham stok şu miktarın altına inince" value={f.hamStokAlt} onChangeText={(t) => set("hamStokAlt", t)} keyboardType="decimal-pad" />
        <Field label="Bitmiş stok şu miktarın altına inince" value={f.bitmisStokAlt} onChangeText={(t) => set("bitmisStokAlt", t)} keyboardType="decimal-pad" />
        <Field label="Geciken sipariş kalemi şu sayıyı aşınca" value={f.gecikenKalemUst} onChangeText={(t) => set("gecikenKalemUst", t)} keyboardType="number-pad" />
        <Field label="Günlük üretim şu miktarın altındaysa" value={f.gunlukUretimAlt} onChangeText={(t) => set("gunlukUretimAlt", t)} keyboardType="decimal-pad" />
        <Field label="Günlük üretim kontrol saati (0–23)" value={f.gunlukUretimSaati} onChangeText={(t) => set("gunlukUretimSaati", t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" />
        <Field label="Fabrikadan şu kadar dakika veri gelmezse" value={f.esitlemeGecikmeDk} onChangeText={(t) => set("esitlemeGecikmeDk", t.replace(/\D/g, "").slice(0, 5))} keyboardType="number-pad" />
      </Card>
    </View>
  );
}
