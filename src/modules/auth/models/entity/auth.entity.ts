export interface AuthUserEntity {
  id: string;
  username: string;
  email: string | null;
  name: string;
  /** Rol principal. */
  role: string;
  /** Roles efectivos: principal + adicionales. */
  roles: string[];
  departmentId: string | null;
  active: boolean;
  password: string;
}