import { Request, Response } from "express";
import { z } from "zod";
import * as service from "./auth.service";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const login = async (req: Request, res: Response) => {
  const { username, password } = loginSchema.parse(req.body);
  const result = await service.login(username, password);
  res.json(result);
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) throw new Error("unauthenticated");
  const result = await service.me(req.user.id);
  res.json(result);
};