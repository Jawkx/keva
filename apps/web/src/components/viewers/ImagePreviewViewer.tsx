import { Maximize2, Minimize2, RotateCcw, RotateCw } from "lucide-react";
import { useState } from "react";
import type { ImageRotation } from "@keva/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const normalizeRotation = (rotation: number): ImageRotation =>
  (((rotation % 360) + 360) % 360) as ImageRotation;

const nearestEquivalentRotation = (rotation: ImageRotation, reference: number): number =>
  rotation + Math.round((reference - rotation) / 360) * 360;

interface ImagePreviewViewerProps {
  readonly src: string;
  readonly alt: string;
  readonly rotation: ImageRotation;
  readonly rotating?: boolean;
  readonly onRotate?: (direction: -1 | 1) => void;
  readonly className?: string;
}

export function ImagePreviewViewer({
  src,
  alt,
  rotation,
  rotating = false,
  onRotate,
  className,
}: ImagePreviewViewerProps) {
  const [naturalAspectRatio, setNaturalAspectRatio] = useState<number | null>(null);
  const [animateRotation, setAnimateRotation] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [rotationState, setRotationState] = useState<{
    source: ImageRotation;
    display: number;
  }>({ source: rotation, display: rotation });
  let displayRotation = rotationState.display;
  if (rotationState.source !== rotation) {
    if (normalizeRotation(displayRotation) !== rotation) {
      displayRotation = nearestEquivalentRotation(rotation, displayRotation);
    }
    setRotationState({ source: rotation, display: displayRotation });
  }
  const normalizedDisplayRotation = normalizeRotation(displayRotation);
  const quarterTurn = normalizedDisplayRotation === 90 || normalizedDisplayRotation === 270;
  const aspectRatio =
    naturalAspectRatio === null
      ? 16 / 9
      : quarterTurn
        ? 1 / naturalAspectRatio
        : naturalAspectRatio;
  const scale =
    naturalAspectRatio !== null && quarterTurn
      ? Math.max(naturalAspectRatio, 1 / naturalAspectRatio)
      : 1;

  return (
    <div
      className={cn(
        "group relative w-full max-w-full overflow-hidden rounded-md bg-muted/30",
        className,
      )}
      style={{ aspectRatio }}
    >
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 rounded-md border border-border/60 bg-background/85 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {onRotate && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Rotate image left 90 degrees"
                    disabled={rotating}
                    onClick={() => {
                      setAnimateRotation(true);
                      setRotationState((current) => ({
                        ...current,
                        display: current.display - 90,
                      }));
                      onRotate(-1);
                    }}
                  />
                }
              >
                <RotateCcw />
              </TooltipTrigger>
              <TooltipContent>Rotate left 90°</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Rotate image right 90 degrees"
                    disabled={rotating}
                    onClick={() => {
                      setAnimateRotation(true);
                      setRotationState((current) => ({
                        ...current,
                        display: current.display + 90,
                      }));
                      onRotate(1);
                    }}
                  />
                }
              >
                <RotateCw />
              </TooltipTrigger>
              <TooltipContent>Rotate right 90°</TooltipContent>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open image full screen"
                onClick={() => setFullScreen(true)}
              />
            }
          >
            <Maximize2 />
          </TooltipTrigger>
          <TooltipContent>Full screen</TooltipContent>
        </Tooltip>
      </div>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn(
          "h-full w-full object-contain",
          animateRotation &&
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{ transform: `rotate(${displayRotation}deg) scale(${scale})` }}
        onTransitionEnd={(event) => {
          if (event.propertyName === "transform") setAnimateRotation(false);
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setNaturalAspectRatio(image.naturalWidth / image.naturalHeight);
          }
        }}
      />
      <Dialog open={fullScreen} onOpenChange={setFullScreen}>
        <DialogContent
          showCloseButton={false}
          className="inset-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-background p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Exit image full screen"
                className="absolute right-3 top-3"
              />
            }
          >
            <Minimize2 />
          </DialogClose>
          <div
            className="max-h-dvh max-w-full overflow-hidden"
            style={{
              aspectRatio,
              width: `min(100vw, calc(100dvh * ${aspectRatio}))`,
              height: `min(100dvh, calc(100vw / ${aspectRatio}))`,
            }}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="h-full w-full object-contain"
              style={{ transform: `rotate(${displayRotation}deg) scale(${scale})` }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
