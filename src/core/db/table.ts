import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import type { ITDataTableResponse } from "@core/utils/table";

type DelegateLike = {
  count: (args?: unknown) => Promise<number>;
  findMany: (args?: unknown) => Promise<unknown[]>;
};

export interface PaginatedQueryArgs<TModel = unknown> {
  model: TModel;
  where?: Record<string, unknown>;
  orderBy?: unknown[];
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  page: number;
  limit: number;
}

/** COUNT + QUERY en una sola transacción (patrón compartido de tablas server-side). */
export const paginatedQuery = async <T, TModel = unknown>(
  args: PaginatedQueryArgs<TModel>
): Promise<ITDataTableResponse<T>> => {
  const { model: rawModel, where = {}, orderBy = [], select, include, page, limit } = args;
  const model = rawModel as unknown as DelegateLike;

  const findManyArgs: Record<string, unknown> = {
    where,
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  };
  if (select) findManyArgs.select = select;
  if (include) findManyArgs.include = include;

  const tx = [model.count({ where }), model.findMany(findManyArgs)] as unknown as [
    Prisma.PrismaPromise<number>,
    Prisma.PrismaPromise<unknown[]>
  ];
  const [total, data] = await prismaClient.$transaction(tx);

  return { data: data as T[], total };
};