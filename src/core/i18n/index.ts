import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { es, type Messages } from "./messages/es";
import { en } from "./messages/en";

/**
 * Traducción de los textos que emite la API (errores, correos, notificaciones,
 * exportaciones). El idioma del sistema vive en `sys_config` (`LANGUAGE`,
 * `es` | `en`); una petición HTTP puede pedir otro con `Accept-Language`.
 *
 * - Respuestas HTTP: `Accept-Language` soportado → idioma del sistema → `es`.
 * - Fuera de una petición (workers, correos, notificaciones guardadas): el
 *   idioma del sistema.
 */

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "es";
export const LANGUAGE_CONFIG_KEY = "LANGUAGE";

const catalogs: Record<Language, Messages> = { es, en };

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

// Llaves con punto de todo el catálogo: "errors.TICKET_NOT_FOUND", "emails.footer", ...
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type ErrorCode = keyof Messages["errors"];
export type MessageParams = Record<string, unknown>;

const lookup = (catalog: Messages, key: string): string | undefined => {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
};

const interpolate = (template: string, params: MessageParams): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? "" : String(value);
  });

/** Traduce `key` al idioma indicado o, si no se indica, al de la petición en curso. */
export const t = (key: MessageKey, params: MessageParams = {}, language?: Language): string => {
  const lng = language ?? currentLanguage();
  const template = lookup(catalogs[lng], key) ?? lookup(catalogs[DEFAULT_LANGUAGE], key) ?? key;
  return interpolate(template, params);
};

// --- idioma del sistema (sys_config LANGUAGE) --------------------------------

type SystemLanguageReader = () => Promise<string | null>;
let readSystemLanguage: SystemLanguageReader | null = null;
let cachedSystemLanguage: Language = DEFAULT_LANGUAGE;

/** Se conecta al arrancar con el lector de `sys_config` (ya cacheado ahí). */
export const setSystemLanguageReader = (reader: SystemLanguageReader): void => {
  readSystemLanguage = reader;
};

/** Idioma del sistema. Si `sys_config` no responde, conserva el último conocido. */
export const systemLanguage = async (): Promise<Language> => {
  if (!readSystemLanguage) return cachedSystemLanguage;
  try {
    const value = await readSystemLanguage();
    cachedSystemLanguage = isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    // sin sys_config se sigue con el último valor leído
  }
  return cachedSystemLanguage;
};

// --- idioma de la petición ----------------------------------------------------

const requestLanguage = new AsyncLocalStorage<Language>();

/** Idioma de la petición en curso; fuera de una petición, el último idioma del sistema leído. */
export const currentLanguage = (): Language => requestLanguage.getStore() ?? cachedSystemLanguage;

/** Primer idioma soportado de un encabezado `Accept-Language` ("en-US,en;q=0.9"). */
export const languageFromHeader = (header: string | undefined): Language | null => {
  if (!header) return null;
  for (const part of header.split(",")) {
    const code = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return null;
};

/** Fija el idioma de la petición (`Accept-Language` → idioma del sistema). */
export const languageMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const fromHeader = languageFromHeader(req.headers["accept-language"]);
  const run = (lng: Language) => requestLanguage.run(lng, next);
  if (fromHeader) {
    run(fromHeader);
    return;
  }
  systemLanguage().then(run, () => run(cachedSystemLanguage));
};
