import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const fmt = printf(({ level, message, timestamp: ts }) => {
  return `${ts} [${level}] ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), fmt),
  transports: [new winston.transports.Console()],
});