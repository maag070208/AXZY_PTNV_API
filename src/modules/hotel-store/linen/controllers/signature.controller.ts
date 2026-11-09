import type { Request, Response } from "express";
import { HotelCosignDto } from "../models/dto/signature.dto";
import type { HotelSignatureService } from "../services/signature.service";

export class HotelSignatureController {
  constructor(private readonly signatures: HotelSignatureService) {}

  cosign = async (req: Request, res: Response) => {
    const { username, password } = HotelCosignDto.parse(req.body);
    res.json(await this.signatures.cosign(username, password, req.user!.id));
  };
}
