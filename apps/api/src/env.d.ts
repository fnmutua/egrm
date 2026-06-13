import 'dotenv/config';
export declare const env: {
    API_PORT: number;
    NOTIFICATIONS_DEV_LOG_ONLY: boolean;
    DATABASE_URL: string;
    JWT_SECRET: string;
    PII_SECRET: string;
    DEFAULT_TENANT: string;
    PUBLIC_PORTAL_BASE_URL: string;
    PORT?: number | undefined;
    SEED_TENANT_HOSTNAMES?: string | undefined;
};
