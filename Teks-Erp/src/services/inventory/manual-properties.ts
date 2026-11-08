// =============================================================================
// Inventory Service / manual-properties
// =============================================================================
// Elle özellik / ölçüm düzeltmesi (applyManualProperties).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (inventory/list.ts sayılır) */

import { ACTIVE_ROLL_PROPERTY, applyRollFlagSetTx } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { postEntryCorrectionTx } from "../helpers/entry-correction-ledger.helper";
import { AuditService } from "../audit.service";
import { resolveFoldTypeForWrite } from "../helpers/fold-type";
import { normalizeLabelBatchNo } from "../helpers/label-batch-no.helper";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { resolveQualityGradeIdStrict } from "../helpers/quality-grade.helper";
import {
  Prisma,
  RollStatus,
} from "@prisma/client";
import { touchWarehouseSackTx } from "../helpers/shipment-locks.helper";
import {
  partitionTargetableIds,
} from "../helpers/targetable-property.helper";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { upperTr } from "../../utils/tr-case";

export async function applyManualProperties(
    rollId: string,
    data: {
      colorId: string | null;
      /**
       * BAYRAK (FLAG) kümesi — `undefined` DOKUNMA, dizi = TAM liste (replace).
       * Faz 0 (OZELLIK-PIVOT-SURUMLEME-PLAN §9, 2026-09-14): alanı yollamayan
       * istemci (tablet Çuval Düzelt yalnız renk/en yollar) eskiden `?? []` ile
       * "hiç özellik" demiş sayılıyor ve her düzeltme topun BÜTÜN bayraklarını
       * siliyordu. `undefined` iken özellik bloğu ve `propsChanged` hiç koşmaz.
       */
      propertyIds?: string[];
      width?: number | null;
      qualityGrade?: string;
      currentQty?: number;
      /**
       * KAT — `undefined` DOKUNMA, `null` TEMİZLE, kod YAZ (foldTypeSchema sözleşmesi).
       *
       * Kat bir SEÇİM (CHOICE) karakteristiğidir ama `RollProperty` pivotunda değil
       * `Roll.foldType` KOLONUNDA yaşar (filtrelenip sıralandığı için) — bu yüzden
       * yukarıdaki "CHOICE satırları bu uçtan yönetilmez" kuralının DIŞINDADIR ve
       * panelden düzeltilebilir. Kesim sırasında istemci alanı düşürdüğü için
       * (2026-08-13) katsız doğmuş topların tek düzeltme yolu burasıdır.
       */
      foldType?: string | null;
      /** Etiket parti no — `undefined` DOKUNMA, null/"" TEMİZLE, metin YAZ (kırpılır). */
      labelBatchNo?: string | null;
      reason?: string;
    },
    userId?: string,
    /** F221 deseni: sağlanırsa süpervizör kapsamı için `roll:manual-adjust` ENFORCE
     *  edilir. Controller `req.user.permissions`'ı HER ZAMAN geçirir; omit =
     *  güvenilen dahili çağrı (test/servis-içi) → kontrol atlanır. */
    opts?: { permissions?: readonly string[] },
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        itemId: true,
        colorId: true,
        status: true,
        width: true,
        qualityGrade: true,
        foldType: true,
        labelBatchNo: true,
        initialQty: true,
        currentQty: true,
        warehouseId: true,
        goodsReceiptId: true,
        shipmentId: true,
        shipment: { select: { status: true } },
        sackId: true,
        sack: { select: { shipmentId: true } },
        // valueType: bu uç yalnız BAYRAK evrenini yönetir (aşağıya bak) —
        // mevcut kümenin FLAG alt kümesini bilmek zorunda.
        properties: {
          where: ACTIVE_ROLL_PROPERTY,
          select: { propertyId: true, property: { select: { valueType: true } } },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.SCRAP || roll.status === RollStatus.CANCELLED) {
      throw AppError.badRequest("Hurda/iptal edilmiş topun rengi/özelliği değiştirilemez");
    }
    // TEK SÖZLEŞME (2026-07-30, F114 revizyonu): statü kapsamı artık TOPUN DURUMUNA
    // bakar, `Boolean(reason)`'a DEĞİL. Eski kurgu iki ucu (relabel / manual-attributes)
    // aynı motoru iki farklı kapsamla çağırıyordu ve iki tuhaflık üretiyordu:
    //   (a) süpervizör istasyondaki topun rengini düzeltebiliyor ama METRAJINI
    //       düzeltemiyordu (depo yolu metrajı alıyordu, süpervizör yolu almıyordu);
    //   (b) kapsamı genişleten şey yetki değil "sebep alanının dolu olması" idi —
    //       koruma örtüktü (yalnız relabel Zod şemasının reason'ı elemesi sayesinde
    //       sömürülemezdi).
    // Yeni kurgu:
    //   ALWAYS_BLOCKED → hiçbir yolla düzeltilemez (sevk↔kabul paritesi + lineage).
    //   FREE_STOCK     → serbest düzeltme: sebep OPSİYONEL, ek yetki yok (depo/mobil).
    //   gerisi (örn. IN_PRODUCTION) → SÜPERVİZÖR: sebep ZORUNLU + `roll:manual-adjust`.
    const ALWAYS_BLOCKED: RollStatus[] = [
      RollStatus.AT_SUBCONTRACTOR,
      RollStatus.AT_KARTELA,
      RollStatus.TAMBUR_CONSUMED,
      RollStatus.SUBCONTRACTOR_CONSUMED,
      RollStatus.KARTELA_CONSUMED,
      RollStatus.RETURNED_FROM_SUBCONTRACTOR,
      RollStatus.SHIPPED,
    ];
    if (ALWAYS_BLOCKED.includes(roll.status)) {
      throw AppError.badRequest(
        "Bu top fason/kartelada, emekliye ayrılmış veya sevk edilmiş — nitelikleri düzeltilemez (sevk↔kabul paritesi ve izlenebilirlik bozulur).",
      );
    }
    const FREE_STOCK: RollStatus[] = [
      RollStatus.STOCK,
      RollStatus.WAREHOUSE,
      RollStatus.A1_STOCK,
    ];
    const needsSupervisor = !FREE_STOCK.includes(roll.status);
    if (needsSupervisor) {
      // F221 deseni: permissions SAĞLANIRSA enforce edilir; omit = güvenilen dahili
      // çağrı (test/servis-içi). Güvenlik sınırı controller'dadır.
      if (
        opts?.permissions !== undefined &&
        !matchesPermission(opts.permissions, "roll:manual-adjust")
      ) {
        // Mesaj İKİ kitleye birden konuşur: depo/mobil operatörü için durum bilgisi
        // ("bu top üretimde, senin yetkin serbest stok içindir"), süpervizör için
        // eksik izin. Yalnız izin adı yazmak depo operatörünü asla alamayacağı bir
        // yetkiye yönlendirirdi (2026-07-31 düzeltmesi).
        throw AppError.forbidden(
          "Bu top serbest satılabilir stokta değil (üretimde) — yalnız süpervizör düzeltebilir ('roll:manual-adjust' yetkisi).",
        );
      }
      if (!data.reason || data.reason.trim().length < 3) {
        throw AppError.badRequest(
          "Bu top serbest satılabilir stokta değil (üretimde) — düzeltme için işlem nedeni (en az 3 karakter) zorunludur.",
        );
      }
    }
    // ÇUVAL HAVUZU: renk/en/kalite değişimi spec-karşılanmayı bozar. Atanmış sevkiyatta
    // (PLANNED/DISPATCHED) VEYA sevkiyattaki çuvalda → reddet (önce çuvaldan çıkar /
    // sevkten çıkar). Açık çuval + serbest WAREHOUSE/STOCK serbest.
    if (roll.shipmentId) {
      throw AppError.conflict(
        "Bu top bir sevkiyata atanmış — etiketi değiştirmeden önce sevkiyattan çıkarın.",
      );
    }
    if (roll.sack && roll.sack.shipmentId != null) {
      throw AppError.conflict(
        "Bu top sevkiyattaki bir çuvalda — etiketi değiştirmeden önce çuvaldan çıkarın.",
      );
    }
    if (data.width !== undefined && data.width !== null && !(data.width > 0)) {
      throw AppError.badRequest("Geçerli bir en (cm) girilmeli");
    }
    // Metraj düzeltmesi — kısmen tüketilmiş topta reddet (currentQty < initialQty →
    // geçmişi sessizce silmemek için); yalnız bütün toplarda (initialQty == currentQty)
    // düzeltmeye izin ver, initialQty ile birlikte güncelle.
    const rollWhole = roll.initialQty.equals(roll.currentQty);
    if (data.currentQty !== undefined) {
      if (!(data.currentQty > 0)) throw AppError.badRequest("Geçerli bir metraj (mt) girilmeli");
      if (!rollWhole) {
        throw AppError.conflict(
          "Bu top kısmen tüketilmiş (kesim/tüketim geçmişi var) — metrajı buradan düzeltilemez.",
        );
      }
    }

    // Catalog doğrulamaları (varsa)
    if (data.colorId) {
      const c = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { isActive: true },
      });
      if (!c || !c.isActive) {
        throw AppError.badRequest("Renk bulunamadı veya pasif");
      }
      // Item allowed list (boş → serbest)
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: roll.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: roll.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
      }
    }
    // ⚠️ BU UÇ YALNIZ BAYRAK (FLAG) EVRENİNİ YÖNETİR (2026-08-11, denetim F1).
    // SEÇİM tipli satırlar (GRAMAJ=50GR gibi, RollProperty.valueId taşıyan) bu
    // uçtan NE SİLİNİR NE YAZILIR — onları istasyon operatörü yönetir.
    //
    // Neden 400 değil SESSİZ AYIRMA: Düzelt diyaloğu bağlamdan gelen TÜM
    // propertyId'leri olduğu gibi geri yollar (echo) ve chips alanı FLAG süzdüğü
    // için CHOICE id "görünmez yolcu"dur — operatör onu seçmedi. 400 dönmek,
    // gramajlı topun HİÇBİR alanını (renk/en/metraj) düzeltilemez yapardı.
    // Eski davranış daha kötüydü: koşulsuz deleteMany+createMany, operatörün
    // tabletteki 50GR seçimini HER kayıtta sessizce siliyordu.
    const propsTouched = data.propertyIds !== undefined;
    const dedupedProps = [...new Set(data.propertyIds ?? [])];
    const { flagIds: dedupedFlagProps, choiceIds: untouchedChoiceIds } =
      propsTouched ? await partitionTargetableIds(dedupedProps) : { flagIds: [], choiceIds: [] };
    if (dedupedFlagProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedFlagProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedFlagProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      // Item allowed-property listesi (boş → serbest) — createInitialEntry PARİTE.
      // Yeniden-etiketlemede de seçilen özellikler ürünün uygulanabilir listesinde
      // olmalı; aksi halde create-path'te reddedilen kombinasyon relabel'la sızardı.
      // ⚠️ Kontrol FLAG kümesiyle: CHOICE id'yi pariteye sokmak, GRAMAJ izinli
      // listede değilse topun TÜM düzeltmelerini 400'e kilitlerdi (denetim F1b).
      const allowedPropCount = await prisma.itemAllowedProperty.count({
        where: { itemId: roll.itemId },
      });
      if (allowedPropCount > 0) {
        const inAllowed = await prisma.itemAllowedProperty.findMany({
          where: { itemId: roll.itemId, propertyId: { in: dedupedFlagProps } },
          select: { propertyId: true },
        });
        if (inAllowed.length !== dedupedFlagProps.length) {
          throw AppError.badRequest(
            "Seçilen özelliklerden biri bu ürüne uygulanabilir listesinde değil",
          );
        }
      }
    }

    // Roll skaler güncellemeleri (renk her zaman; en/kalite verildiyse).
    const rollData: Prisma.RollUncheckedUpdateManyInput = {};
    if (roll.colorId !== data.colorId) rollData.colorId = data.colorId;
    if (data.width !== undefined) rollData.width = data.width === null ? null : new Prisma.Decimal(data.width);
    // Metraj: bütün topta initialQty + currentQty birlikte güncellenir (ölçüm düzeltmesi);
    // değer aynıysa no-op. rollWhole guard yukarıda garantiledi.
    if (data.currentQty !== undefined && !roll.currentQty.equals(new Prisma.Decimal(data.currentQty))) {
      const m = new Prisma.Decimal(data.currentQty);
      rollData.currentQty = m;
      rollData.initialQty = m;
    }
    if (data.qualityGrade !== undefined && data.qualityGrade.trim()) {
      // Soft-delete giriş guard'ı (createInitialEntry/tambur finalize ile PARİTE):
      // operatör girdisi kataloğa karşı SIKI doğrulanır (bilinmeyen/pasif kod → 400),
      // ve canonical FK (qualityGradeId) snapshot ile BİRLİKTE yazılır — yoksa
      // snapshot↔FK ayrışır (qualityGradeRef raporları bayatlar) + typo'lu kod
      // FIRE-dışlama filtresinden kaçıp byQuality istatistiklerini bölerdi.
      const code = data.qualityGrade.trim();
      rollData.qualityGradeId = await resolveQualityGradeIdStrict(code);
      rollData.qualityGrade = code;
    }
    // KAT — katalog doğrulaması + kanoniklik TEK YERDE (`resolveFoldTypeForWrite`;
    // kesim/finalize/elle ekleme yollarıyla AYNI fonksiyon). Burada elle karşılaştırma
    // yapma: "4 kat" yazımı normalleşmeden kaydedilirse envanterin kat filtresi o topu
    // BULAMAZ ve hata/log çıkmaz (2026-08-04 notu).
    const resolvedFold = await resolveFoldTypeForWrite(data.foldType);
    const foldChanged = resolvedFold !== undefined && resolvedFold !== roll.foldType;
    if (foldChanged) rollData.foldType = resolvedFold;
    // Etiket parti no düzeltmesi müşteri ayarına BAĞLI DEĞİL: ayar sonradan kapansa da
    // yanlış basılmış değer panelden temizlenebilmeli.
    const resolvedLabelBatch = normalizeLabelBatchNo(data.labelBatchNo);
    const labelBatchChanged = resolvedLabelBatch !== undefined && resolvedLabelBatch !== roll.labelBatchNo;
    if (labelBatchChanged) rollData.labelBatchNo = resolvedLabelBatch;

    // Etiket bayat: etiket-görünür bir alan (renk/en/metraj/kalite/özellik) GERÇEKTEN
    // değiştiyse topun fiziksel etiketi artık uyuşmuyor → labelDirty=true (baskıda temizlenir).
    // NOT: kalite/en blokları değer aynı olsa da yazılabildiğinden (FK self-heal / unconditional),
    // "değişti mi"yi Object.keys(rollData) yerine alan-alan karşılaştır → no-op kayıtta dirty olmaz.
    // ⚠️ Karşılaştırma FLAG evreniyle: CHOICE satırları bu uçta değişmez, kümeye
    // katmak echo edilen id yüzünden her kayıtta sahte propsChanged üretirdi
    // (etiket boşuna bayatlar).
    const existingPropIds = new Set(
      roll.properties.filter((p) => p.property.valueType === "FLAG").map((p) => p.propertyId),
    );
    let flagDelta: { revokedPropertyIds: string[]; addedPropertyIds: string[] } | null = null;
    const propsChanged =
      propsTouched &&
      (dedupedFlagProps.length !== existingPropIds.size ||
        dedupedFlagProps.some((id) => !existingPropIds.has(id)));
    const oldWidth = roll.width == null ? null : Number(roll.width);
    const widthChanged = data.width !== undefined && data.width !== oldWidth;
    const colorChanged = roll.colorId !== data.colorId;
    const metrajChanged =
      data.currentQty !== undefined && !roll.currentQty.equals(new Prisma.Decimal(data.currentQty));
    const qualityChanged =
      data.qualityGrade !== undefined &&
      data.qualityGrade.trim() !== "" &&
      data.qualityGrade.trim() !== roll.qualityGrade;
    // ⚠️ `foldChanged` de etiketi bayatlatır: kat 2026-08-13'ten beri etiket alan
    // kataloğunda (ROLL_RAW + ROLL_FINISHED) — şablona sürüklenmişse kâğıda basılıyor.
    if (colorChanged || widthChanged || metrajChanged || qualityChanged || propsChanged || foldChanged || labelBatchChanged) {
      rollData.labelDirty = true;
    }

    await prisma.$transaction(async (tx) => {
      // TOCTOU (çuval havuzu): pre-tx kontrol tx DIŞINDA okundu — top bu sırada bir
      // sevkiyata atanmış olabilir (renk/en değişimi donmuş/havuz tahsisini bozar).
      // Çözüm: bağı tx İÇİNDE taze oku; atanmışsa 409; çuvaldaysa
      // touchWarehouseSackTx ile çuval satırına serileş; yazımı pinle.
      const cur = await tx.roll.findUnique({ where: { id: rollId }, select: { shipmentId: true, sackId: true } });
      if (!cur) throw AppError.notFound("Top bulunamadı");
      if (cur.shipmentId) {
        throw AppError.conflict("Top bu sırada bir sevkiyata atandı — etiketi değiştirmeden önce sevkiyattan çıkarın.");
      }
      if (cur.sackId) {
        await touchWarehouseSackTx(tx, cur.sackId);
      }

      // 1) Roll skaler alanları (renk/en/kalite/metraj) — atomik claim.
      //
      // ⚠️ CLAIM YALNIZ ÜYELİĞİ DEĞİL, KARARIN DAYANDIĞI ALANLARI DA PİNLER.
      // Eskiden `where` yalnız `{ id, shipmentId: null, sackId }` idi; oysa bu
      // fonksiyonun İKİ kararı da tx DIŞINDA okunan `roll` satırından geliyor:
      //   • kapsam/yetki kararı  → `roll.status` (FREE_STOCK mu, süpervizör mü)
      //   • metraj düzeltme izni → `rollWhole = initialQty.equals(currentQty)`
      // Aradaki pencerede Tambur kesimi (`cutWarehouseRoll`) topun İKİ metrajını
      // da düşürür ve yazım MUTLAK olduğu için (`currentQty = initialQty = m`)
      // kesimi sessizce geri alır. Ölçüldü (audit_repro_D-A-01, 10/10 tekrar):
      // 100 m'lik top, 40,5 m kesildikten sonra sistemde 140,5 m görünüyordu —
      // fiziksel olarak var olmayan 40,5 m stoğa yazılmış oluyordu (BULGU-T1-001).
      //
      // `rollWhole` guard'ını tx İÇİNE taşımak YETMEZ: kesim parent'ın ikisini de
      // düşürdüğü için kesimden SONRA da `initialQty == currentQty` olur, yani
      // guard yeniden hesaplansa bile yeşil kalır. Tek çözüm okunan değeri
      // pinlemektir — "gördüğüm satır hâlâ aynıysa yaz, değilse 409".
      // Claim KOŞULSUZ (Y6, 2026-09-14): yalnız-özellik düzeltmesinde `rollData` boştur
      // ama top satırı yine de pinlenir — eskiden o yolda top HİÇ kilitlenmiyordu ve
      // araya giren kesim/sevk ile özellik yazımı yarışabiliyordu. Boş veri
      // `updatedAt: new Date()` ile aynı pini koşturur, `count === 0 → 409`.
      {
        const pin: Prisma.RollWhereInput = {
          id: rollId,
          shipmentId: null,
          sackId: cur.sackId,
          // Kapsam kararı bu statüden çözüldü (BULGU-T1-085).
          status: roll.status,
        };
        // Metraj YAZILIYORSA okunan metraj da pinlenir. Yalnız yazıldığında:
        // toplu renk/en düzeltmesi (`applyAttributeToRolls`) metraj göndermez ve
        // üretimdeki topun metrajı meşru olarak değişebilir — orada pinlemek
        // gereksiz 409 üretirdi.
        if (rollData.currentQty !== undefined) {
          pin.currentQty = roll.currentQty;
          pin.initialQty = roll.initialQty;
        }
        // D4-E2a: en'in ikinci yazarı ölçülen en — Düzelt en yazıyorsa okunan en pinlenir, ölçüm sessiz ezilmez.
        if (rollData.width !== undefined) pin.width = roll.width;
        const upd = await tx.roll.updateMany({
          where: pin,
          data: Object.keys(rollData).length > 0 ? rollData : { updatedAt: new Date() },
        });
        if (upd.count === 0) {
          // Çakışma yolunda TEK ek okuma: operatöre "ne değişti"yi söylemek,
          // "yenileyip tekrar deneyin"i tahmin ettirmekten iyidir.
          const taze = await tx.roll.findUnique({
            where: { id: rollId },
            select: { status: true, currentQty: true, shipmentId: true, sackId: true },
          });
          const neden = !taze
            ? "top bu sırada silindi"
            : taze.shipmentId
              ? "top bu sırada bir sevkiyata atandı"
              : taze.sackId !== cur.sackId
                ? "topun çuvalı bu sırada değişti"
                : taze.status !== roll.status
                  ? `topun durumu bu sırada değişti (${roll.status} → ${taze.status})`
                  : !taze.currentQty.equals(roll.currentQty)
                    ? `topun metrajı bu sırada değişti (${roll.currentQty.toString()} → ${taze.currentQty.toString()} m) — büyük olasılıkla Tambur'da kesildi`
                    : "top bu sırada başka bir işlemle güncellendi";
          throw AppError.conflict(
            `${upperTr(neden.charAt(0))}${neden.slice(1)} — düzeltme uygulanmadı. Ekranı yenileyip güncel değerlerle tekrar deneyin.`,
          );
        }
        // 1b) GİRİŞ ÖLÇÜMÜ DÜZELTMESİ DEFTERE (tek yazıcı, claim'in arkasında aynı tx):
        // sapma + stok defteri ENTRY_CORRECTION — kabul-anı okuyucuları bunu toplar (K §4g).
        if (rollData.currentQty !== undefined && metrajChanged) {
          await postEntryCorrectionTx(tx, { roll, yeniQty: new Prisma.Decimal(data.currentQty as number), reason: data.reason, userId: userId ?? null });
        }
      }

      // 2) Roll.properties — YALNIZ BAYRAK EVRENİ ve YALNIZ alan geldiyse (`undefined` =
      //    dokunma, Faz 0). FARK BAZLI + SÜRÜMLEYEREK (③a, 2026-09-14): çıkan bayrak
      //    damgalanır (silinmez), giren yazılır, değişmeyen satıra dokunulmaz. SEÇİM
      //    satırlarına (valueId taşıyanlar) dokunulmaz: operatörün istasyonda yaptığı
      //    değer seçimini (50GR) yok etmek olurdu (denetim F1).
      if (propsTouched) {
        flagDelta = await applyRollFlagSetTx(tx, {
          rollId,
          desired: dedupedFlagProps,
          reason: data.reason ? `MANUAL_OVERRIDE: ${data.reason}` : "MANUAL_OVERRIDE",
          userId: userId ?? null,
        });
      }

    });

    // F119: audit tx-DIŞI (best-effort konvansiyonu — bu dosyadaki diğer tüm CUD
    // gibi). oldData/newData tx öncesi yüklenen `roll` + `data` + `dedupedProps`
    // kapsamda kalır; yazım hatası mutasyonu düşürmez.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_MANUAL_OVERRIDE",
      recordId: rollId,
      oldData: {
        colorId: roll.colorId,
        width: roll.width != null ? Number(roll.width) : null,
        qualityGrade: roll.qualityGrade,
        foldType: roll.foldType,
        labelBatchNo: roll.labelBatchNo,
        currentQty: Number(roll.currentQty),
      },
      newData: {
        colorId: data.colorId,
        // `undefined` = alan gelmedi, bayraklara DOKUNULMADI (Faz 0) — audit'te `[]`
        // ("hepsi silindi") ile karışmasın.
        propertyIds: propsTouched ? dedupedFlagProps : undefined,
        // Sürümleme izi: hangi bayrak damgalandı, hangisi yeni yazıldı (etiket haritasında).
        revokedPropertyIds: (flagDelta as { revokedPropertyIds: string[] } | null)?.revokedPropertyIds,
        addedPropertyIds: (flagDelta as { addedPropertyIds: string[] } | null)?.addedPropertyIds,
        // Sessiz ayırma audit'te GÖRÜNMEZ olmasın: bu id'ler istemciden geldi
        // ama SEÇİM tipli oldukları için bu uç onlara dokunmadı.
        untouchedChoicePropertyIds: untouchedChoiceIds,
        width: data.width,
        qualityGrade: data.qualityGrade,
        // KANONİK değer yazılır (istemcinin ham girdisi değil) — audit ile kolon
        // ayrışırsa "ne yazıldı" sorusunun iki cevabı olur.
        foldType: resolvedFold ?? null,
        labelBatchNo: resolvedLabelBatch,
        currentQty: data.currentQty ?? null,
        reason: data.reason ?? null,
        // Saha akışı (Yeniden Etiketle) sebep göndermez → RELABEL; süpervizör
        // "Manuel Düzelt" zorunlu sebep gönderir → MANUAL_ATTRIBUTE.
        event: data.reason ? "MANUAL_ATTRIBUTE" : "RELABEL",
      },
    });

    return {
      success: true,
      data: {
        rollId,
        colorId: data.colorId,
        propertyIds: dedupedFlagProps,
        width: data.width,
        qualityGrade: data.qualityGrade,
        currentQty: data.currentQty,
      },
      message: `Top etiketi güncellendi`,
    };
  }
