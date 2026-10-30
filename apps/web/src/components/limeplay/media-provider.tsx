"use client";

import * as React from "react";
import { useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createStore, type StoreApi } from "zustand/vanilla";

import { type MediaProviderProps, type MediaStore } from "@/hooks/limeplay/use-media";

export type { MediaProviderProps, MediaStore };

/**
 * A Zustand store API extended with Immer-style `setState`.
 *
 * Unlike vanilla Zustand's `setState(partial)`, this accepts a mutator function
 * that receives a mutable draft of the state:
 *
 * ```ts
 * store.setState(({ volume }) => {
 *   volume.level = 0.5
 * })
 * ```
 */
export type ImmerStoreApi<T> = StoreApi<T> & {
  setState: (updater: (state: T) => void) => void;
};

// ── Event bridge ──────────────────────────────────────────────────────

export declare const mediaEventMap: unique symbol;

/**
 * Typed event emitter interface. Features call `emit()`, consumers call `on()` / `once()`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MediaEvents<TEvents extends {} = {}> {
  emit<TName extends Extract<keyof TEvents, string>>(
    name: TName,
    ...args: EventArgs<TEvents[TName]>
  ): void;
  on<TName extends Extract<keyof TEvents, string>>(
    name: TName,
    listener: EventListener<TEvents[TName]>,
  ): () => void;
  once<TName extends Extract<keyof TEvents, string>>(
    name: TName,
    listener: EventListener<TEvents[TName]>,
  ): () => void;
}

/**
 * Brand interface that marks a store slice with its event types.
 * When multiple slices are intersected, their event maps merge automatically.
 *
 * ```ts
 * export interface VolumeEvents {
 *   volumeChange: { muted: boolean; volume: number }
 * }
 * export interface VolumeStore extends MediaEventSlice<VolumeEvents> {
 *   volume: { level: number; muted: boolean }
 * }
 * ```
 */
export interface MediaEventSlice<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TEvents extends {} = {},
> {
  readonly [mediaEventMap]?: TEvents;
}

/**
 * Defines a media feature slice. Each feature owns a namespaced key in the store.
 *
 * @typeParam TSlice - The shape of this feature's state (e.g. `VolumeStore`).
 * @typeParam TStore - The full store shape visible to `createSlice`. Defaults to the
 *   base `MediaStore`. Widen this when your slice needs cross-feature access
 *   (e.g. `MediaStore & PlayerStore`).
 *
 * ```ts
 * export function volumeFeature(): MediaFeature<VolumeStore> {
 *   return {
 *     key: "volume",
 *     createSlice: (set, get) => ({ volume: { level: 1, ... } }),
 *     Setup: VolumeSetup, // optional component mounted inside MediaProvider
 *   }
 * }
 * ```
 */
export interface MediaFeature<
  TSlice extends object,
  TStore extends MediaStore & TSlice = MediaStore & TSlice,
> {
  createSlice: (
    set: ImmerStoreApi<TStore>["setState"],
    get: StoreApi<TStore>["getState"],
    store: ImmerStoreApi<TStore>,
    events: MediaEvents<EventsFromStore<TStore>>,
  ) => TSlice;
  key: keyof TSlice & string;
  Setup?: React.ComponentType;
}

/**
 * Derives the full store type from an array of features.
 *
 * ```ts
 * type Store = MediaStoreFromFeatures<typeof features>
 * // MediaStore & VolumeStore & PlaybackStore & ...
 * ```
 */
export type MediaStoreFromFeatures<TFeatures extends readonly MediaFeature<any, any>[]> = Simplify<
  MediaStore & UnionToIntersection<SliceFromFeature<TFeatures[number]>>
>;

// ── Event bridge internal types ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type AnyEvents = {};

type AnyMediaStore = MediaStore & object;

type EventArgs<TPayload> = 0 extends 1 & TPayload
  ? [payload?: TPayload]
  : [TPayload] extends [void]
    ? []
    : [payload: TPayload];

type EventListener<TPayload> = (...args: EventArgs<TPayload>) => void;

type EventsFromStore<TStore> = TStore extends MediaEventSlice<infer TEvents> ? TEvents : AnyEvents;

interface MediaRuntimeContextValue {
  events: MediaEvents<AnyEvents>;
  featureKeys: Set<string>;
  store: ImmerStoreApi<AnyMediaStore>;
}

type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

type SliceFromFeature<TFeature> = TFeature extends MediaFeature<infer TSlice, any> ? TSlice : never;

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

// ── Event bridge class ───────────────────────────────────────────────

class MediaEventChannel<TPayload> {
  private listeners = new Set<EventListener<TPayload>>();

  emit(eventName: string, ...args: EventArgs<TPayload>) {
    for (const listener of this.listeners) {
      try {
        listener(...args);
      } catch (cause) {
        console.error(`[MediaEvents] Error in "${eventName}" listener:`, cause);
      }
    }
  }

  on(listener: EventListener<TPayload>) {
    this.listeners.add(listener);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.listeners.delete(listener);
    };
  }
}

class MediaEventEmitter<TEvents extends AnyEvents> implements MediaEvents<TEvents> {
  private channels: Partial<{
    [TName in Extract<keyof TEvents, string>]: MediaEventChannel<TEvents[TName]>;
  }> = {};

  emit = <TName extends Extract<keyof TEvents, string>>(
    name: TName,
    ...args: EventArgs<TEvents[TName]>
  ) => {
    this.channels[name]?.emit(name, ...args);
  };

  on = <TName extends Extract<keyof TEvents, string>>(
    name: TName,
    listener: EventListener<TEvents[TName]>,
  ) => {
    let channel = this.channels[name];

    if (!channel) {
      channel = new MediaEventChannel<TEvents[TName]>();
      this.channels[name] = channel;
    }

    return channel.on(listener);
  };

  once = <TName extends Extract<keyof TEvents, string>>(
    name: TName,
    listener: EventListener<TEvents[TName]>,
  ) => {
    const off = this.on(name, (...args) => {
      off();
      listener(...args);
    });

    return off;
  };
}

const MediaRuntimeContext = React.createContext<MediaRuntimeContextValue | null>(null);

/**
 * Creates a fully-typed media runtime from a list of feature slices.
 *
 * Returns a `MediaProvider` component and typed hooks scoped to all registered features.
 *
 * ```ts
 * const media = createMediaKit({
 *   features: [
 *     mediaFeature(),
 *     playerFeature(),
 *     volumeFeature(),
 *   ] as const,
 * })
 *
 * // Use in your app:
 * <media.MediaProvider>
 *   <App />
 * </media.MediaProvider>
 *
 * // Access store from any child:
 * const volume = media.useMediaStore(s => s.volume.level)
 * const api = media.useMediaApi() // full store API for mutations
 * ```
 */
export function createMediaKit<
  const TFeatures extends readonly MediaFeature<any, any>[] = readonly MediaFeature<any, any>[],
>({ features }: { features: TFeatures }) {
  type RuntimeStore = MediaStoreFromFeatures<TFeatures>;
  type RuntimeEvents = EventsFromStore<RuntimeStore>;

  function createMediaStore() {
    const events = new MediaEventEmitter<RuntimeEvents>();

    const store = createStore<RuntimeStore>()(
      immer((set, get, store) => {
        const slices = features.map((feature) => {
          // SAFETY: RuntimeStore contains every feature slice and dependency declared by this kit's feature tuple.
          return feature.createSlice(
            set as ImmerStoreApi<RuntimeStore>["setState"],
            get as StoreApi<RuntimeStore>["getState"],
            store as ImmerStoreApi<RuntimeStore>,
            events as MediaEvents<EventsFromStore<RuntimeStore>>,
          );
        });

        // SAFETY: Each registered feature contributes its declared slice, whose intersection is RuntimeStore.
        return Object.assign({}, ...slices) as RuntimeStore;
      }),
    );

    // SAFETY: Zustand's immer middleware installs the mutating setState overload represented by ImmerStoreApi.
    return { events, store: store as ImmerStoreApi<RuntimeStore> };
  }

  const featureKeys = new Set<string>(features.map((feature) => feature.key));

  function MediaProvider({ children, debug }: React.PropsWithChildren<MediaProviderProps>) {
    const [runtime] = React.useState(() => {
      const created = createMediaStore();
      if (debug !== undefined) setMediaDebug(created.store, debug);
      return created;
    });
    const contextValue = React.useMemo((): MediaRuntimeContextValue => {
      // SAFETY: React context erases this kit's generic parameters; runtime retains the same store and emitter instances.
      return {
        events: runtime.events as MediaEvents<AnyEvents>,
        featureKeys,
        store: runtime.store as ImmerStoreApi<AnyMediaStore>,
      };
    }, [runtime]);

    React.useLayoutEffect(() => {
      if (debug === undefined) return;

      setMediaDebug(runtime.store, debug);
    }, [debug, runtime.store]);

    return (
      <MediaRuntimeContext.Provider value={contextValue}>
        {children}
        {features.map((feature) => {
          if (!feature.Setup) {
            return null;
          }

          const Setup = feature.Setup;

          return <Setup key={feature.key} />;
        })}
      </MediaRuntimeContext.Provider>
    );
  }

  function useTypedMediaStore<TSelected>(selector: (state: RuntimeStore) => TSelected): TSelected {
    const { store } = useMediaRuntime();

    return useStore(adaptMediaStore<RuntimeStore>(store), selector);
  }

  function useTypedMediaApi(): ImmerStoreApi<RuntimeStore> {
    const { store } = useMediaRuntime();

    return adaptMediaStore<RuntimeStore>(store);
  }

  function useTypedMediaEvents(): MediaEvents<RuntimeEvents> {
    const { events } = useMediaRuntime();

    return adaptMediaEvents<RuntimeEvents>(events);
  }

  return {
    features,
    MediaProvider,
    useMediaApi: useTypedMediaApi,
    useMediaEvents: useTypedMediaEvents,
    useMediaStore: useTypedMediaStore,
  };
}

/**
 * Returns the raw Immer store API for direct state reads and mutations.
 * Use this in effects, callbacks, or when you need `getState()` / `setState()`
 * without subscribing to re-renders.
 *
 * For most components, prefer `useMediaStore` or per-feature hooks instead.
 *
 * ```ts
 * const api = useMediaApi()
 * api.getState().volume.level       // read without subscribing
 * api.setState(({ volume }) => {
 *   volume.level = 0.5
 * })
 * ```
 */
export function useMediaApi<TStore extends AnyMediaStore = AnyMediaStore>() {
  const { store } = useMediaRuntime();

  return adaptMediaStore<TStore>(store);
}

/**
 * Returns the event emitter for the current MediaProvider.
 * Features emit events; consumers subscribe via `on()` / `once()`.
 *
 * ```ts
 * const events = useMediaEvents<VolumeStore>()
 * useEffect(() => {
 *   return events.on(\"volumechange\", ({ volume }) => {
 *     console.log("Volume:", volume)
 *   })
 * }, [events])
 * ```
 */
export function useMediaEvents<TEvents extends AnyEvents = AnyEvents>(): MediaEvents<TEvents> {
  const { events } = useMediaRuntime();

  return adaptMediaEvents<TEvents>(events);
}

/**
 * Returns the Immer store API scoped to a specific feature slice.
 * Throws if the feature is not registered in `createMediaKit`.
 *
 * Primarily used inside `Setup` components and hooks that belong to a feature.
 *
 * ```ts
 * const store = useMediaFeatureApi<VolumeStore>("volume")
 * store.getState().volume.level
 * store.setState(({ volume }) => { volume.muted = true })
 * ```
 */
export function useMediaFeatureApi<TSlice extends object>(
  featureKey: string,
): ImmerStoreApi<MediaStore & TSlice> {
  const { featureKeys, store } = useMediaRuntime();

  assertFeature(featureKey, featureKeys);

  return adaptMediaStore<MediaStore & TSlice>(store);
}

/**
 * Subscribes to a specific feature's state with a selector.
 * Throws if the feature is not registered. Only re-renders when the
 * selected value changes (compared via `Object.is`).
 *
 * Typically wrapped by per-feature convenience hooks like `useVolumeStore`.
 *
 * ```ts
 * const level = useMediaFeatureStore<VolumeStore, number>(
 *   "volume",
 *   (state) => state.volume.level
 * )
 * ```
 */
export function useMediaFeatureStore<TSlice extends object, TSelected>(
  featureKey: string,
  selector: (state: MediaStore & TSlice) => TSelected,
): TSelected {
  const { featureKeys, store } = useMediaRuntime();

  assertFeature(featureKey, featureKeys);

  return useStore(adaptMediaStore<MediaStore & TSlice>(store), selector);
}

function assertFeature(featureKey: string, featureKeys: Set<string>) {
  if (!featureKeys.has(featureKey)) {
    throw new Error(
      `Missing "${featureKey}" feature in MediaProvider. Add ${featureKey}Feature() to createMediaKit({ features }).`,
    );
  }
}

function adaptMediaEvents<TEvents extends AnyEvents>(
  events: MediaEvents<AnyEvents>,
): MediaEvents<TEvents> {
  // SAFETY: Event maps are owned by the active kit; hooks request subsets declared by its registered features.
  return events as MediaEvents<TEvents>;
}

function adaptMediaStore<TStore extends AnyMediaStore>(
  store: ImmerStoreApi<AnyMediaStore>,
): ImmerStoreApi<TStore> {
  // SAFETY: Store types are intersections of slices registered in the active kit and checked before feature access.
  return store as ImmerStoreApi<TStore>;
}

function setMediaDebug(store: ImmerStoreApi<AnyMediaStore>, debug: boolean) {
  store.setState(({ media }) => {
    media.debug = debug;
  });
}

function useMediaRuntime() {
  const context = React.useContext(MediaRuntimeContext);

  if (!context) {
    throw new Error("Missing MediaProvider in root");
  }

  return context;
}
