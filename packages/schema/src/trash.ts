import { Schema } from "effect";
import { ItemId } from "./common.js";
import type { KevaItem } from "./item.js";
import { OwnerItem, toOwnerItem } from "./shares.js";

export const TrashItem = Schema.Struct({
  ...OwnerItem.fields,
  deletedAt: Schema.String,
});
export type TrashItem = typeof TrashItem.Type;

export const toTrashItem = (item: KevaItem & { readonly deletedAt: string }): TrashItem => ({
  ...toOwnerItem(item),
  deletedAt: item.deletedAt,
});

export const TrashResult = Schema.Struct({
  items: Schema.Array(TrashItem),
});
export type TrashResult = typeof TrashResult.Type;

export const BatchRestore = Schema.Struct({
  ids: Schema.Array(ItemId).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1000)),
  ),
});
export type BatchRestore = typeof BatchRestore.Type;

export const BatchRestoreResult = Schema.Struct({
  restored: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, error: Schema.String })),
});
export type BatchRestoreResult = typeof BatchRestoreResult.Type;
