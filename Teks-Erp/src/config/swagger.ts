import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import path from 'path';
import { uyari } from '../lib/logger';

// F11: apis glob'unu __dirname'e göre kur — CWD'den bağımsız + özyinelemeli
// (routes/reports/*.ts alt dizini eskiden taranmıyordu) + hem .ts (dev/ts-node)
// hem .js (derlenmiş prod dist) tarasın. glob 7 (swagger-jsdoc bağımlılığı) TÜM
// platformlarda yalnız '/' ayracını kabul ettiğinden Windows'ta path.join'in
// ürettiği '\' forward-slash'a normalize edilir (yoksa prod'da 0 dosya eşlenir).
const apiGlob = (rel: string): string => path.join(__dirname, rel).replace(/\\/g, '/');

// Bekçi (`scripts/test_swagger_spec.ts`) aynı seçenekleri `failOnErrors: true` ile
// koşar: bozuk bir @openapi YAML bloğu burada yalnız konsola düşer ve uç Swagger'dan
// sessizce kaybolur (2026-08-21'de `roll-attribute-targets` böyle kayboldu) — bekçi
// onu geliştirme anında kırmızıya çevirir.
export const swaggerOptions: swaggerJSDoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'TeksERP Core API',
            version: '1.0.0',
            description: 'Core API for TeksERP System encompassing Production, Inventory, Planning and Logistics.',
        },
        servers: [
            {
                url: 'http://localhost:4000',
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: [
        apiGlob('../routes/**/*.ts'),
        apiGlob('../routes/**/*.js'),
        apiGlob('../controllers/**/*.ts'),
        apiGlob('../controllers/**/*.js'),
    ], // Generate documentation from routes and controllers (recursive; dev .ts + prod .js)
};

const options = swaggerOptions;

export const setupSwagger = (app: Express): void => {
    // Production'da API dokümantasyonu GİZLENİR: /api-docs yalnız dev/test'te mount
    // edilir. Üretim sunucusunda iç API şemasını dışarıya açmamak için (güvenlik).
    if (process.env.NODE_ENV === "production") return;

    // ⚠️ SPEC BURADA üretilir, MODÜL GÖVDESİNDE DEĞİL (2026-09-07).
    // Üretim paketi `deploy/paketle.ps1` içinde `tsc --removeComments` ile
    // derlenir (bilinçli karar: yorumlar tasarım gerekçesi taşıyor, kopyalanan
    // `dist` kaynak kadar değerli olmasın). Bu bayrak `@openapi` bloklarını da
    // siler, yani üretimde spec ZORUNLU OLARAK boştur — kusur değil, sonuç.
    //
    // Spec modül gövdesinde üretilince bunun iki bedeli vardı ve ikisi de
    // sahada ölçüldü (fabrika logu 2026-09-04/05): üretimde her açılışta ~500
    // dosya boşuna taranıyor, ve hata log'una "/api-docs boş görünecek" uyarısı
    // düşüyordu — oysa /api-docs üretimde HİÇ mount edilmiyor. Uyarı gerçek bir
    // arızayı değil, bilinçli bir kararı bildiriyordu; hata log'unu kirletmesi
    // dışında bir etkisi yoktu ve "sunucuda bir şey bozuk" izlenimi veriyordu.
    const swaggerSpec = swaggerJSDoc(options);

    // F11: sessiz bozulmayı görünür kıl — glob CWD/uzantı uyuşmazlığında spec
    // boş kalır. Uyarı ARTIK YALNIZ dev/test'te anlamlı, çünkü yalnız orada
    // eyleme dönüşebilir (üretimde beklenen durum boş spec'tir).
    const swaggerPaths = (swaggerSpec as { paths?: Record<string, unknown> }).paths;
    if (!swaggerPaths || Object.keys(swaggerPaths).length === 0) {
        uyari(
            'swagger',
            'OpenAPI spec BOŞ — hiçbir route/controller taranamadı ' +
            '(apis glob CWD/uzantı uyuşmazlığı olabilir). /api-docs boş görünecek.',
        );
    }

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
