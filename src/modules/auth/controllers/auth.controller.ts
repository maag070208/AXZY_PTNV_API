import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { LoginInputSchema } from "../models/dto/auth.dto";
import { AuthService } from "../services/auth.service";

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (req: Request, res: Response) => {
    const { username, password } = LoginInputSchema.parse(req.body);
    const result = await this.service.login(username, password);
    res.json(result);
  };

  me = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const result = await this.service.me(req.user.id);
    res.json(result);
  };
}