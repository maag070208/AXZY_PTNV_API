-- Warehouse permissions (plan 10). Roles and their scopes are seeded at startup from roles/role_permissions.json.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_store.view', 'Hotel', 'View hotel store', 'Stock, movements and the ledger of the warehouse', ARRAY['OWN', 'AREA', 'ALL']::"PermissionScope"[], false, true, 910, CURRENT_TIMESTAMP),
  ('hotel_store.stock_in', 'Hotel', 'Hotel store inbound', 'Register inbound stock and initial loads', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 911, CURRENT_TIMESTAMP),
  ('hotel_store.stock_out', 'Hotel', 'Hotel store outbound', 'Manual consumption and write-offs', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 912, CURRENT_TIMESTAMP),
  ('hotel_store.transfer', 'Hotel', 'Hotel store transfers', 'Transfers between warehouses and locations', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 913, CURRENT_TIMESTAMP),
  ('hotel_store.adjust', 'Hotel', 'Hotel store adjustments', 'Stock adjustments from counts', ARRAY['ALL']::"PermissionScope"[], false, true, 914, CURRENT_TIMESTAMP),
  ('hotel_store.adjust_approve', 'Hotel', 'Approve adjustments', 'Approve adjustments above the threshold and stocktakes', ARRAY['ALL']::"PermissionScope"[], false, true, 915, CURRENT_TIMESTAMP),
  ('hotel_store.stocktake', 'Hotel', 'Stocktakes', 'Create, count and close stocktakes', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 916, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
