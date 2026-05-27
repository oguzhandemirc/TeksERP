import "dotenv/config"; // .env yükle — diğer tüm importlardan ÖNCE (JWT_SECRET vb. modül-load anında okunur)
import "./lib/zod-locale"; // Zod tr locale
import app from './app';
import { startArchiveScheduler } from './jobs/archive-scheduler';
import { AuditService } from './services/audit.service';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`[server]: Server is running at http://localhost:${PORT}`);
    console.log(`[swagger]: API documentation available at http://localhost:${PORT}/api-docs`);
    startArchiveScheduler();

    void AuditService.logEvent({
        category: "SYSTEM",
        action: "STARTUP",
        payload: {
            port: Number(PORT),
            env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
            nodeVersion: process.version,
        },
    });
});
