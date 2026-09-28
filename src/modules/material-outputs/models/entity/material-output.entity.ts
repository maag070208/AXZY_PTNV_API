export type MaterialOutputReason = "DAMAGED" | "OBSOLETE" | "LOST" | "OTHER";

export interface MaterialOutputInput {
  date?: string;
  description: string;
  model?: string;
  brand?: string;
  project?: string;
  quantity?: number;
  departmentName: string;
  userName: string;
  notes?: string;
  area?: string;
  reason?: MaterialOutputReason;
  deviceUnitId?: string;
}
