import { useRef, useState } from "react";
import { IconCloudUpload, IconFile, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { errorMessage } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { keva } from "../lib/keva";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

export function UploadModal({
  open,
  onOpenChange,
  onUploaded,
}: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setDragging(false);
  };

  const upload = async (target: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      await keva.upload(
        {
          name: target.name,
          contentType: target.type || "application/octet-stream",
          size: target.size,
          source: "upload",
          attributes: {},
        },
        bytes,
      );
      toast.success(`Uploaded ${target.name}`);
      onUploaded();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload object</DialogTitle>
          <DialogDescription>
            Add a file to keva. You can edit its attributes afterwards.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-primary/5",
          )}
        >
          {file ? (
            <>
              <IconFile className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
            </>
          ) : (
            <>
              <IconCloudUpload className="size-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Drag a file here, or click to choose
              </span>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) setFile(chosen);
            }}
          />
        </button>

        {file && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={reset}
            disabled={busy}
          >
            <IconX data-icon="inline-start" />
            Clear selection
          </Button>
        )}

        <DialogFooter showCloseButton>
          <Button
            disabled={!file || busy}
            onClick={() => file && upload(file)}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
