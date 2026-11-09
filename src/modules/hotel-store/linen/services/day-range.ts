import { HttpError } from "@core/middlewares/error.middleware";

/** `AAAA-MM-DD` -> [inicio del día, inicio del día siguiente) en hora local del servidor. Sin fecha, hoy. */
export const dayRange = (value?: string | null, now: Date = new Date()): { from: Date; to: Date } => {
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = now.getDate();
  if (value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new HttpError(400, "INVALID_FILTER", { field: "date" });
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  }
  const from = new Date(year, month, day);
  if (Number.isNaN(from.getTime())) throw new HttpError(400, "INVALID_FILTER", { field: "date" });
  return { from, to: new Date(year, month, day + 1) };
};
