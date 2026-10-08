import fs from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

/**
 * Hosted Postgres (AWS RDS) only accepts TLS connections.
 *   - Put `?sslmode=require` on DATABASE_URL. The Prisma CLI (migrate, seed) reads that.
 *   - Set DB_SSL_CA_FILE to the RDS CA bundle so the app also checks it is talking to the
 *     real server: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
 * node-postgres would otherwise treat sslmode=require as "verify against the system CAs",
 * which fails for RDS, so sslmode is taken off the URL here and TLS is configured directly.
 */
const buildPoolConfig = (databaseUrl) => {
  if (!databaseUrl) return { connectionString: databaseUrl };

  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get('sslmode');
  if (!sslmode || sslmode === 'disable') return { connectionString: databaseUrl };

  url.searchParams.delete('sslmode');
  const caFile = process.env.DB_SSL_CA_FILE;
  if (caFile) {
    return { connectionString: url.toString(), ssl: { ca: fs.readFileSync(caFile, 'utf8') } };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL uses sslmode but DB_SSL_CA_FILE is not set');
  }
  console.warn('DB TLS: encrypted but the server certificate is not verified. Set DB_SSL_CA_FILE.');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
};

const adapter = new PrismaPg(buildPoolConfig(process.env.DATABASE_URL));
const prisma = new PrismaClient({ adapter });

export default prisma;
