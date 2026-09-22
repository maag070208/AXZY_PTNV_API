export interface SysConfigRecord {
  id: string;
  key: string;
  value: string;
  descripcion: string | null;
  updatedAt: Date;
  updatedById: string | null;
  updatedBy?: { id: string; name: string } | null;
}