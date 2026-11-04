// Belge Tara ekran testlerinin sahte sayfaları ve kamera modal taklitleri (jest.mock fabrikasından requireActual ile).
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { photoSha256 } from '../screens/Modules/GelenBelge/docScan';

// Sahte JPEG (sihirli bayt) — her çekimde aynı içerik: ikinci çekim aynı fotoğraftır.
const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag.repeat(40))]).toString('base64');
export const PAGE_B64 = jpeg('sayfa-1');
export const PAGE_B64_B = jpeg('sayfa-2');

const shot = (b64: string, uri: string) => ({ base64: b64, sha256: photoSha256(b64), uri, width: 2600, height: 1950 });

/** `single` = PageCameraModal (`onCaptured(sayfa)`), `multi` = MultiPageCameraModal (`onDone([sayfa])`). */
export function cameraModalMock(kind: 'single' | 'multi') {
  type Props = { visible: boolean; onCaptured?: (x: unknown) => void; onDone?: (x: unknown[]) => void };
  const give = (p: Props, b64: string, uri: string) => (kind === 'multi' ? p.onDone?.([shot(b64, uri)]) : p.onCaptured?.(shot(b64, uri)));
  const CameraMock = (p: Props) =>
    p.visible ? (
      <View>
        <Pressable testID="sayfa-kamera" onPress={() => give(p, PAGE_B64, 'file:///1.jpg')}>
          <Text>kamera</Text>
        </Pressable>
        <Pressable testID="sayfa-kamera-2" onPress={() => give(p, PAGE_B64_B, 'file:///2.jpg')}>
          <Text>kamera 2</Text>
        </Pressable>
      </View>
    ) : null;
  return { __esModule: true, default: CameraMock };
}
