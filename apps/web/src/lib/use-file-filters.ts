import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PropertyValue, QueryCondition } from "@keva/schema";
import {
  createFilterDraft,
  draftFromConditions,
  encodeFilterParam,
  type FilterDraft,
} from "./item-filters";
import { useMountEffect } from "./useMountEffect";

export function useFileFilters({
  viewId,
  initialWhere,
  onQueryChange,
}: {
  readonly viewId?: string | undefined;
  readonly initialWhere: readonly QueryCondition[];
  readonly onQueryChange: () => void;
}) {
  const [, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activeWhere, setActiveWhere] = useState<QueryCondition[]>(() => [...initialWhere]);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(() =>
    draftFromConditions(initialWhere),
  );
  const searchTimer = useRef<number | undefined>(undefined);
  useMountEffect(() => () => window.clearTimeout(searchTimer.current));

  const applyWhere = useCallback(
    (where: QueryCondition[]) => {
      onQueryChange();
      if (viewId) {
        setActiveWhere(where);
        return;
      }
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (where.length > 0) params.set("filter", encodeFilterParam(where));
          else params.delete("filter");
          return params;
        },
        { replace: true },
      );
    },
    [onQueryChange, setSearchParams, viewId],
  );

  const filterByProperty = useCallback(
    (key: string, value: PropertyValue) => {
      const condition: QueryCondition =
        value === null || Array.isArray(value) ? { key, op: "exists" } : { key, op: "eq", value };
      const next = [
        ...activeWhere.filter(
          (item) => !(item.key === key && (item.op === "eq" || item.op === "exists")),
        ),
        condition,
      ];
      setFilterDraft(draftFromConditions(next));
      applyWhere(next);
    },
    [activeWhere, applyWhere],
  );

  const onSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSearch(value);
      window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => {
        setActiveSearch(value.trim());
        onQueryChange();
      }, 300);
    },
    [onQueryChange],
  );

  const clearFilters = useCallback(() => {
    window.clearTimeout(searchTimer.current);
    setSearch("");
    setActiveSearch("");
    setFilterDraft(createFilterDraft());
    applyWhere([]);
  }, [applyWhere]);

  return {
    search,
    activeSearch,
    activeWhere,
    setActiveWhere,
    filterDraft,
    setFilterDraft,
    applyWhere,
    filterByProperty,
    onSearchChange,
    clearFilters,
  };
}
