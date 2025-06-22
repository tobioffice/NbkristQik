import { config } from 'dotenv';

config();

const ENV = process.env.ENV || 'development';
const TELEGRAM_BOT_TOKEN = ENV === 'production' ? process.env.TELEGRAM_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN_DEV || '';
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const N_USERNAME = process.env.N_USERNAME || '';
const N_PASSWORD = process.env.N_PASSWORD || '';
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;

export {
    ENV,
    TELEGRAM_BOT_TOKEN,
    TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN,
    N_USERNAME,
    N_PASSWORD,
    ADMIN_ID
};