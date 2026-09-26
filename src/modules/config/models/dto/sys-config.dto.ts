import { HttpError } from "@core/middlewares/error.middleware";

const requireString = (
  v: unknown,
  field: string,
  { min, max, allowEmpty }: { min: number; max: number; allowEmpty: boolean }
): string => {
  if (typeof v !== "string") {
    throw new HttpError(400, "FIELD_MUST_BE_STRING", { field });
  }
  if (!allowEmpty && v.length === 0) {
    throw new HttpError(400, "FIELD_EMPTY", { field });
  }
  if (v.length > max) {
    throw new HttpError(400, "FIELD_TOO_LONG", { field, max });
  }
  if (allowEmpty && v.length === 0) return v;
  if (v.length < min) {
    throw new HttpError(400, "FIELD_TOO_SHORT", { field, min });
  }
  return v;
};

const optionalString = (
  v: unknown,
  field: string,
  { max }: { min: number; max: number }
): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new HttpError(400, "FIELD_MUST_BE_STRING", { field });
  }
  if (v.length > max) {
    throw new HttpError(400, "FIELD_TOO_LONG", { field, max });
  }
  return v;
};

export const SysConfigUpdateInput = {
  value: (v: unknown) =>
    requireString(v, "value", { min: 1, max: 5000, allowEmpty: false }),
  description: (v: unknown) =>
    optionalString(v, "description", { min: 0, max: 200 }),
};

export const SysConfigKey = /^[A-Z][A-Z0-9_]+$/;

export const assertSysConfigKey = (key: string): void => {
  if (!SysConfigKey.test(key)) {
    throw new HttpError(400, "INVALID_CONFIG_KEY");
  }
  if (key.length > 100) {
    throw new HttpError(400, "KEY_TOO_LONG", { max: 100 });
  }
};

export const parseSysConfigUpdateBody = (body: unknown): {
  value: string;
  description?: string;
} => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "INVALID_BODY");
  }
  const b = body as Record<string, unknown>;
  const value = SysConfigUpdateInput.value(b.value);
  const description = SysConfigUpdateInput.description(b.description);
  return { value, description };
};