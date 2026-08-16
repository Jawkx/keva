import {
  Files,
  File,
  History,
  PanelLeft,
  Plug,
  Search,
  Settings,
  Tags,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Schema } from "effect";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { useSidebar } from "@/components/ui/sidebar";
import {
  includesSearch,
  isGlobalSearchShortcut,
  metadataSuggestionUrl,
} from "../lib/global-search";
import { errorMessage } from "../lib/errors";
import { formatContentType, formatRelative } from "../lib/format";
import { keva } from "../lib/keva";
import { useMountEffect } from "../lib/useMountEffect";
import { listViews, viewsQueryKey } from "../lib/views";
import { viewIcon } from "./view-icons";

const FILE_RESULT_LIMIT = 8;
const SEARCH_DELAY_MS = 200;

const PAGES: ReadonlyArray<{
  title: string;
  url: string;
  keywords: string;
  icon: LucideIcon;
}> = [
  { title: "All files", url: "/", keywords: "home files", icon: Files },
  { title: "Trash", url: "/trash", keywords: "deleted restore", icon: Trash2 },
  { title: "Connection", url: "/connection", keywords: "mcp api tokens", icon: Plug },
  { title: "Settings", url: "/settings", keywords: "account appearance storage", icon: Settings },
];

const RECENT_SEARCHES_KEY = "keva:recent-searches:v1";
const RecentSearches = Schema.Array(Schema.String);

const highlighted = (text: string, query: string) => {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/15 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
};

const readRecentSearches = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Schema.is(RecentSearches)(stored) ? stored.slice(0, 5) : [];
  } catch {
    return [];
  }
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState(readRecentSearches);
  const searchTimer = useRef<number | undefined>(undefined);
  const normalizedSearch = search.trim();
  const canSearchRemotely = open && remoteSearch.length >= 2;

  const { data: views } = useQuery({ queryKey: viewsQueryKey, queryFn: listViews });
  const filesQuery = useQuery({
    queryKey: ["global-search", "files", remoteSearch],
    queryFn: () =>
      keva.query({
        where: [],
        search: remoteSearch,
        searchFields: ["name", "content_type"],
        limit: FILE_RESULT_LIMIT,
        order: "created_at_desc",
      }),
    enabled: canSearchRemotely,
  });
  const propertiesQuery = useQuery({
    queryKey: ["global-search", "properties", remoteSearch],
    queryFn: () => keva.propertySuggestions(remoteSearch),
    enabled: canSearchRemotely,
  });
  const remoteResultsCurrent = remoteSearch === normalizedSearch;
  const fileResults = remoteResultsCurrent ? (filesQuery.data?.items ?? []) : [];
  const propertyResults = remoteResultsCurrent ? (propertiesQuery.data ?? []) : [];

  const focusedFileId = sessionStorage.getItem("keva:focused-file");
  const commands = [
    {
      title: "Upload files",
      keywords: "add import",
      icon: Upload,
      shortcut: "U",
      run: () => window.dispatchEvent(new Event("keva:upload")),
    },
    {
      title: "Open Trash",
      keywords: "deleted restore",
      icon: Trash2,
      shortcut: "T",
      run: () => navigate("/trash"),
    },
    {
      title: "Toggle sidebar",
      keywords: "navigation collapse expand",
      icon: PanelLeft,
      shortcut: "B",
      run: toggleSidebar,
    },
    ...(focusedFileId
      ? [
          {
            title: "Open selected file properties",
            keywords: "metadata edit focused",
            icon: Tags,
            shortcut: "P",
            run: () => navigate(`/items/${focusedFileId}?panel=properties`),
          },
          {
            title: "Download selected file",
            keywords: "save focused",
            icon: File,
            shortcut: "D",
            run: () => {
              void keva
                .getDownloadUrl(focusedFileId)
                .then((target) => {
                  const anchor = document.createElement("a");
                  anchor.href = target.url;
                  anchor.download = "";
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                })
                .catch((error) => toast.error(errorMessage(error)));
            },
          },
        ]
      : []),
  ];
  const matchingCommands = commands.filter(
    (command) =>
      !normalizedSearch || includesSearch(`${command.title} ${command.keywords}`, normalizedSearch),
  );

  const matchingViews = (views ?? [])
    .filter((view) => !normalizedSearch || includesSearch(view.name, normalizedSearch))
    .slice(0, 8);
  const matchingPages = PAGES.filter(
    (page) =>
      !normalizedSearch || includesSearch(`${page.title} ${page.keywords}`, normalizedSearch),
  );
  const searching =
    (normalizedSearch.length >= 2 && !remoteResultsCurrent) ||
    filesQuery.isFetching ||
    propertiesQuery.isFetching;
  const hasResults =
    matchingCommands.length > 0 ||
    matchingPages.length > 0 ||
    matchingViews.length > 0 ||
    fileResults.length > 0 ||
    propertyResults.length > 0;

  useMountEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(searchTimer.current);
    };
  });

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) return;
    window.clearTimeout(searchTimer.current);
    setSearch("");
    setRemoteSearch("");
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setRemoteSearch("");
      return;
    }
    searchTimer.current = window.setTimeout(() => setRemoteSearch(trimmed), SEARCH_DELAY_MS);
  };

  const rememberSearch = () => {
    if (normalizedSearch.length < 2) return;
    const next = [
      normalizedSearch,
      ...recentSearches.filter((value) => value !== normalizedSearch),
    ].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  };

  const select = (url: string) => {
    rememberSearch();
    onOpenChange(false);
    navigate(url);
  };

  return (
    <div className="w-auto sm:w-full sm:max-w-xl">
      <Button
        type="button"
        variant="outline"
        aria-label="Search files, metadata, views, and pages"
        onClick={() => setOpen(true)}
        className="w-9 justify-start bg-muted/40 px-2.5 font-normal text-muted-foreground sm:w-full sm:px-3"
      >
        <Search data-icon="inline-start" />
        <span className="hidden sm:inline">Search everything</span>
        <span className="ml-auto hidden rounded border bg-background px-1.5 py-0.5 text-[10px] leading-none lg:inline">
          Ctrl K
        </span>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Search Keva"
        description="Search files, metadata, saved views, and pages"
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={onSearchChange}
            placeholder="Search files, metadata, views, and pages..."
          />
          <CommandList>
            {!hasResults && (
              <CommandEmpty>
                {searching ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Searching
                  </span>
                ) : normalizedSearch.length < 2 ? (
                  "Type at least 2 characters to search files and metadata."
                ) : (
                  "No results found."
                )}
              </CommandEmpty>
            )}

            {matchingCommands.length > 0 && (
              <CommandGroup heading="Commands">
                {matchingCommands.map((command) => (
                  <CommandItem
                    key={command.title}
                    value={`command:${command.title}`}
                    onSelect={() => {
                      onOpenChange(false);
                      command.run();
                    }}
                  >
                    <command.icon />
                    <span>{command.title}</span>
                    <CommandShortcut>{command.shortcut}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {normalizedSearch.length < 2 && recentSearches.length > 0 && (
              <CommandGroup heading="Recent searches">
                {recentSearches.map((value) => (
                  <CommandItem
                    key={value}
                    value={`recent:${value}`}
                    onSelect={() => onSearchChange(value)}
                  >
                    <History />
                    <span className="truncate">{value}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {fileResults.length > 0 && (
              <CommandGroup heading="Files">
                {fileResults.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`file:${item.id}`}
                    onSelect={() => select(`/items/${item.id}`)}
                  >
                    <File />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{highlighted(item.name, normalizedSearch)}</span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <span>
                          {highlighted(formatContentType(item.contentType), normalizedSearch)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span title={new Date(item.updatedAt).toLocaleString()}>
                          {formatRelative(item.updatedAt)}
                        </span>
                        {Object.keys(item.properties).length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">
                              {Object.keys(item.properties).slice(0, 2).join(", ")}
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {propertyResults.length > 0 && (
              <CommandGroup heading="Metadata filters">
                {propertyResults.map((suggestion) => {
                  const label =
                    suggestion.value === undefined
                      ? suggestion.key
                      : `${suggestion.key}: ${suggestion.value}`;
                  return (
                    <CommandItem
                      key={`${suggestion.key}:${suggestion.value ?? "*"}`}
                      value={`metadata:${label}`}
                      onSelect={() => select(metadataSuggestionUrl(suggestion))}
                    >
                      <Tags />
                      <span className="truncate">{label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">Filter files</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {matchingViews.length > 0 && (
              <CommandGroup heading="Views">
                {matchingViews.map((view) => {
                  const Icon = viewIcon(view.icon);
                  return (
                    <CommandItem
                      key={view.id}
                      value={`view:${view.id}`}
                      onSelect={() => select(`/v/${view.id}`)}
                    >
                      <Icon />
                      <span className="truncate">{view.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {matchingPages.length > 0 && (
              <>
                {fileResults.length + propertyResults.length + matchingViews.length > 0 && (
                  <CommandSeparator />
                )}
                <CommandGroup heading="Pages">
                  {matchingPages.map((page) => (
                    <CommandItem
                      key={page.url}
                      value={`page:${page.url}`}
                      onSelect={() => select(page.url)}
                    >
                      <page.icon />
                      {page.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
