import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { LoginInputSchema, RefreshInputSchema } from "../models/dto/auth.dto";
import { AuthService } from "../services/auth.service";

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (req: Request, res: Response) => {
    const { username, password } = LoginInputSchema.parse(req.body);
    const result = await this.service.login(username, password);
    res.json(result);
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = RefreshInputSchema.parse(req.body);
    res.json(await this.service.refresh(refreshToken));
  };

  me = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const result = await this.service.me(req.user.id);
    res.json(result);
  };
}