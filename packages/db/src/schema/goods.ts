import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, primaryKey } from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { timestamptzNow } from "./common.ts";
import { goods } from "./sales.ts";

// SPEC-100 §38 `app.goods_inventory` (Part IX Goods). Keyed by goods_id, so a Goods row has at most one
// inventory row (DB-GDS-001); there is no identity column and no created_at. These declarations exist
// for types and queries; the DDL source of truth is migrations/0003_public_content_sales.sql
// (SPEC-100 §57, DB-MIG-002). ck_goods_inventory_capacity is the last defence against overselling
// (DB-GDS-003, DI-030-006).

export const goodsInventory = app.table(
  "goods_inventory",
  {
    goodsId: bigint("goods_id", { mode: "bigint" }).notNull(),
    saleableCapacity: integer("saleable_capacity").notNull(),
    heldQuantity: integer("held_quantity").notNull().default(0),
    committedQuantity: integer("committed_quantity").notNull().default(0),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_goods_inventory", columns: [t.goodsId] }),
    foreignKey({
      name: "fk_goods_inventory_goods",
      columns: [t.goodsId],
      foreignColumns: [goods.id],
    }).onDelete("restrict"),
    check("ck_goods_inventory_saleable_capacity", sql`${t.saleableCapacity} >= 0`),
    check("ck_goods_inventory_held_quantity", sql`${t.heldQuantity} >= 0`),
    check("ck_goods_inventory_committed_quantity", sql`${t.committedQuantity} >= 0`),
    check(
      "ck_goods_inventory_capacity",
      sql`${t.heldQuantity}::bigint + ${t.committedQuantity} <= ${t.saleableCapacity}`,
    ),
  ],
);
