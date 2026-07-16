import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import path from 'path';

// F11: apis glob'unu __dirname'e göre kur — CWD'den bağımsız + özyinelemeli
// (routes/reports/*.ts alt dizini eskiden taranmıyordu) + hem .ts (dev/ts-node)
// hem .js (derlenmiş prod dist) tarasın. glob 7 (swagger-jsdoc bağımlılığı) TÜM
// platformlarda yalnız '/' ayracını kabul ettiğinden Windows'ta path.join'in
// ürettiği '\' forward-slash'a normalize edilir (yoksa prod'da 0 dosya eşlenir).
const apiGlob = (rel: string): string => path.join(__dirname, rel).replace(/\\/g, '/');

const options: swaggerJSDoc.Options = {
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

const swaggerSpec = swaggerJSDoc(options);

// F11: sessiz bozulmayı görünür kıl — glob CWD/uzantı uyuşmazlığında spec boş kalır.
const swaggerPaths = (swaggerSpec as { paths?: Record<string, unknown> }).paths;
if (!swaggerPaths || Object.keys(swaggerPaths).length === 0) {
    console.warn(
        '[swagger] UYARI: OpenAPI spec BOŞ — hiçbir route/controller taranamadı ' +
        '(apis glob CWD/uzantı uyuşmazlığı olabilir). /api-docs boş görünecek.',
    );
}

export const setupSwagger = (app: Express): void => {
    // Production'da API dokümantasyonu GİZLENİR: /api-docs yalnız dev/test'te mount
    // edilir. Üretim sunucusunda iç API şemasını dışarıya açmamak için (güvenlik).
    if (process.env.NODE_ENV === "production") return;
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
