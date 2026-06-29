import { useRef, useState } from "react";
import { IconCloudUpload, IconFile, IconX } from "@tabler/icons-react";
import { formatBytes } from "../lib/format";
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
  // Hands the chosen files to the parent, which uploads them in the background
  // (rows appear immediately in the list with their own progress/error state).
  onUpload: (files: File[]) => void;
  // Files dropped onto the page before the modal opened. Seeded as initial
  // state; callers remount via `key` to refresh it (no effect needed).
  initialFiles?: File[];
}

export function UploadModal({
  open,
  onOpenChange,
  onUpload,
  initialFiles = [],
}: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [dragging, setDragging] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const submit = () => {
    if (files.length === 0) return;
    onUpload(files);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload items</DialogTitle>
          <DialogDescription>
            Add one or more files to keva. You can edit their properties
            afterwards.
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
            addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <IconCloudUpload className="size-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Drag files here, or click to choose
          </span>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => addFiles(e.target.files)}
          />
        </button>

        {files.length > 0 && (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
              >
                <IconFile className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(file.size)}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  <IconX />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter showCloseButton>
          <Button disabled={files.length === 0} onClick={submit}>
            Upload{files.length > 1 ? ` ${files.length}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
