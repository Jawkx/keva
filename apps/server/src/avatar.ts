import { AvatarRecipe, type AvatarRecipe as AvatarRecipeType } from "@keva/schema";
import { inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Schema } from "effect";
import * as authSchema from "./auth-schema.js";

export const parseAvatarRecipe = (
  value: string | null | undefined,
): AvatarRecipeType | undefined => {
  if (!value) return undefined;
  try {
    return Schema.decodeUnknownSync(AvatarRecipe)(JSON.parse(value));
  } catch {
    return undefined;
  }
};

export const serializeAvatarRecipe = (value: unknown): string =>
  JSON.stringify(
    Schema.decodeUnknownSync(AvatarRecipe)(typeof value === "string" ? JSON.parse(value) : value),
  );

export const avatarForUser = (userId: string, value: string | null | undefined): AvatarRecipeType =>
  parseAvatarRecipe(value) ?? { version: 1, seed: userId };

export type UserAvatarResolver = (
  userIds: ReadonlyArray<string>,
) => Promise<ReadonlyMap<string, AvatarRecipeType>>;

export const makeUserAvatarResolver =
  (database: PostgresJsDatabase<any>): UserAvatarResolver =>
  async (userIds) => {
    if (userIds.length === 0) return new Map();
    const users = await database
      .select({ id: authSchema.user.id, avatar: authSchema.user.avatar })
      .from(authSchema.user)
      .where(inArray(authSchema.user.id, [...new Set(userIds)]));
    return new Map(users.map((user) => [user.id, avatarForUser(user.id, user.avatar)]));
  };
