import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { PermissionService } from "../services/permission.service";
import {
  parseCatalogCreateBody,
  parseCatalogUpdateBody,
  parseMatrixBody,
  parseRoleCreateBody,
  parseRoleUpdateBody,
} from "../models/dto/permission.dto";
import { parsePolicyCreateBody, parsePolicyUpdateBody } from "../models/dto/policy.dto";
import { parseSimulationBody } from "../models/dto/access.dto";
import { parseTableParams } from "@core/utils/table";
import { PolicyService } from "../services/policy.service";
import { AccessService } from "../services/access.service";

export class PermissionController {
  constructor(
    private readonly svc: PermissionService,
    private readonly policySvc: PolicyService = new PolicyService(),
    private readonly accessSvc: AccessService = new AccessService()
  ) {}

  members = async (_req: Request, res: Response) => {
    res.json(await this.accessSvc.members());
  };

  memberAccess = async (req: Request, res: Response) => {
    res.json(await this.accessSvc.userAccess(req.params.userId));
  };

  addRoleMember = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    res.json(await this.accessSvc.addRoleMember(req.params.key, req.params.userId, req.user.id));
  };

  removeRoleMember = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    res.json(await this.accessSvc.removeRoleMember(req.params.key, req.params.userId, req.user.id));
  };

  simulate = async (req: Request, res: Response) => {
    res.json(await this.accessSvc.simulate(parseSimulationBody(req.body)));
  };

  activity = async (req: Request, res: Response) => {
    res.json(await this.accessSvc.activity(parseTableParams(req.body)));
  };

  admin = async (_req: Request, res: Response) => {
    res.json(await this.svc.adminData());
  };

  catalog = async (_req: Request, res: Response) => {
    res.json(await this.svc.getActiveCatalog());
  };

  roles = async (_req: Request, res: Response) => {
    res.json(await this.svc.listRoles());
  };

  createRole = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const dto = parseRoleCreateBody(req.body);
    res.status(201).json(await this.svc.createRole(dto, req.user.id));
  };

  updateRole = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const dto = parseRoleUpdateBody(req.body);
    res.json(await this.svc.updateRole(req.params.key, dto, req.user.id));
  };

  deleteRole = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    await this.svc.deleteRole(req.params.key, req.user.id);
    res.status(204).send();
  };

  policies = async (_req: Request, res: Response) => {
    res.json(await this.policySvc.list());
  };

  createPolicy = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    res.status(201).json(await this.policySvc.create(parsePolicyCreateBody(req.body), req.user.id));
  };

  updatePolicy = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    res.json(await this.policySvc.update(req.params.id, parsePolicyUpdateBody(req.body), req.user.id));
  };

  deletePolicy = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    await this.policySvc.remove(req.params.id, req.user.id);
    res.status(204).send();
  };

  create = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const dto = parseCatalogCreateBody(req.body);
    const data = await this.svc.createCatalog(dto, req.user.id);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const { key } = req.params;
    const dto = parseCatalogUpdateBody(req.body);
    const data = await this.svc.updateCatalog(key, dto, req.user.id);
    res.json(data);
  };

  matrix = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    const { changes } = parseMatrixBody(req.body);
    const data = await this.svc.saveMatrix(changes, req.user.id);
    res.json(data);
  };

  reload = async (_req: Request, res: Response) => {
    await Promise.all([this.svc.reload(), this.policySvc.reload()]);
    res.json({ ok: true });
  };
}
