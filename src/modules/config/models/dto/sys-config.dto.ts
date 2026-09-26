import { HttpError } from "@core/middlewares/error.middleware";

const requireString = (
  v: unknown,
  field: string,
  { min, max, allowEmpty }: { min: number; max: number; allowEmpty: boolean }
): string => {
  if (typeof v !== "string") {
    throw new HttpError(400, `${field} debe ser string`);
  }
  if (!allowEmpty && v.length === 0) {
    throw new HttpError(400, `${field} no puede estar vacío`);
  }
  if (v.length > max) {
    throw new HttpError(400, `${field} excede ${max} caracteres`);
  }
  if (allowEmpty && v.length === 0) return v;
  if (v.length < min) {
    throw new HttpError(400, `${field} debe tener al menos ${min} caracteres`);
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
    throw new HttpError(400, `${field} debe ser string`);
  }
  if (v.length > max) {
    throw new HttpError(400, `${field} excede ${max} caracteres`);
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
    throw new HttpError(
      400,
      "La clave debe iniciar con letra mayúscula y contener solo letras mayúsculas, dígitos y guion bajo (snake_case UPPER)"
    );
  }
  if (key.length > 100) {
    throw new HttpError(400, "La clave excede 100 caracteres");
  }
};

export const parseSysConfigUpdateBody = (body: unknown): {
  value: string;
  description?: string;
} => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Body inválido");
  }
  const b = body as Record<string, unknown>;
  const value = SysConfigUpdateInput.value(b.value);
  const description = SysConfigUpdateInput.description(b.description);
  return { value, description };
};