import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("expense_groups_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().positive().default(3001)
});

export const env = envSchema.parse(process.env);
