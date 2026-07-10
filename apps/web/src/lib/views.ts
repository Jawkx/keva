import type { CreateView, UpdateView } from "@keva/schema";
import { keva } from "./keva";

export const viewsQueryKey = ["views"] as const;
export const viewQueryKey = (id: string) => ["views", id] as const;

export const listViews = () => keva.listViews();
export const getView = (id: string) => keva.getView(id);
export const createView = (input: CreateView) => keva.createView(input);
export const updateView = (id: string, input: UpdateView) => keva.updateView(id, input);
export const deleteView = (id: string) => keva.deleteView(id);
