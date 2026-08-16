import isString from "lodash/isString";
import { useEffect, useMemo, useRef } from "react";

import type { GetAssetId, PlayerSource, TAsset, UseAssetOptions } from "@/hooks/limeplay/use-asset";

import { AssetSourceOrigin, AssetSourceType, useAsset } from "@/hooks/limeplay/use-asset";
import { usePlayerStore } from "@/hooks/limeplay/use-player";

export interface PlaybackSourceControllerProps<TItem extends TAsset> {
  autoLoad?: boolean;
  initialIndex?: number;
  loading?: UseAssetOptions<TItem>;
  source?: PlayerSource<TItem>;
  sourceKey?: string;
}

export function PlaybackSourceController<TItem extends TAsset>(
  props: PlaybackSourceControllerProps<TItem>,
) {
  usePlaybackSource(props);

  return null;
}

function getSourceOrigin<TItem extends TAsset>(
  source: PlayerSource<TItem> | undefined,
): Parameters<GetAssetId<TItem>>[1]["origin"] {
  if (Array.isArray(source)) return AssetSourceOrigin.Playlist;
  if (isString(source)) return AssetSourceOrigin.MediaProps;
  return AssetSourceOrigin.Asset;
}

function isAssetSourceArray<TItem extends TAsset>(
  source: PlayerSource<TItem> | undefined,
): source is readonly TItem[] {
  return Array.isArray(source);
}

function usePlaybackSource<TItem extends TAsset>(
  options: PlaybackSourceControllerProps<TItem>,
): void {
  const { autoLoad = true, initialIndex = 0, loading, source, sourceKey } = options;

  const assets = useMemo((): TItem[] => {
    if (isAssetSourceArray(source)) return [...source];
    if (source && !isString(source)) return [source];
    return [];
  }, [source]);
  const player = usePlayerStore((state) => state.instance);
  const { loadSource } = useAsset<TItem>();
  const loadedSourceKeyRef = useRef<null | string>(null);

  useEffect(() => {
    loadedSourceKeyRef.current = null;
  }, [player]);

  const resolvedSourceKey = useMemo(() => {
    if (sourceKey) return sourceKey;

    if (isString(source)) return source;

    return assets
      .map((item, index) => {
        const id =
          item.id ??
          loading?.getAssetId?.(item, {
            index,
            origin: getSourceOrigin(source),
          }) ??
          item.src;

        return id ?? `item:${index}`;
      })
      .join("|");
  }, [assets, loading, source, sourceKey]);
  const sourceType = useMemo<AssetSourceType>(() => {
    return Array.isArray(source) ? AssetSourceType.Playlist : AssetSourceType.Asset;
  }, [source]);
  const requestKey = useMemo(
    () => `${resolvedSourceKey}::${sourceType}::${initialIndex}`,
    [initialIndex, resolvedSourceKey, sourceType],
  );

  useEffect(() => {
    loadedSourceKeyRef.current = null;
  }, [requestKey]);

  useEffect(() => {
    if (
      !autoLoad ||
      !player ||
      source === undefined ||
      (Array.isArray(source) && source.length === 0)
    ) {
      return;
    }

    if (loadedSourceKeyRef.current === requestKey) return;
    loadedSourceKeyRef.current = requestKey;

    const loadOptions: Parameters<typeof loadSource>[1] = {
      initialIndex,
      sourceType,
    };
    if (loading !== undefined) loadOptions.loading = loading;
    if (sourceKey !== undefined) loadOptions.sourceKey = sourceKey;
    loadSource(source, loadOptions);
  }, [
    assets,
    autoLoad,
    initialIndex,
    loadSource,
    player,
    requestKey,
    resolvedSourceKey,
    source,
    sourceKey,
    sourceType,
    loading,
  ]);
}
