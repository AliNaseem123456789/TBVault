import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  engine: 'classic',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})