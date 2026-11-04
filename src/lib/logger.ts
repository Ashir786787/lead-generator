import pino from "pino";
import { env } from "@/lib/env";

const isDev = !env.isProduction && !env.isTest;

export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.cookie",
      "GOOGLE_PLACES_API_KEY",
      "DATABASE_URL",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
