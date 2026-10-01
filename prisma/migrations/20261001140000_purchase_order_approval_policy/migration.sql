-- Política ABAC de aprobación de órdenes de compra: límite de monto y roles
-- que pueden aprobar por encima del límite. Se editan con `system.configure`.
INSERT INTO "sys_config" ("id", "key", "value", "description", "updatedAt")
VALUES
  ('sys_config_po_approval_limit', 'PURCHASE_ORDER_APPROVAL_LIMIT', '0', 'Monto (antes de IVA de referencia) a partir del cual una orden de compra solo la aprueban los roles de PURCHASE_ORDER_HIGH_APPROVAL_ROLES. 0 = sin tope.', now()),
  ('sys_config_po_high_roles', 'PURCHASE_ORDER_HIGH_APPROVAL_ROLES', '', 'Claves de rol (separadas por coma) que pueden aprobar órdenes por encima de PURCHASE_ORDER_APPROVAL_LIMIT. Vacío = cualquiera con el permiso.', now())
ON CONFLICT ("key") DO NOTHING;
