import { useState, type ReactElement } from "react";
import {
  Airplane01Icon,
  Alert01Icon,
  Analytics01Icon,
  Archive01Icon,
  Atom01Icon,
  Attachment01Icon,
  Award01Icon,
  Bicycle01Icon,
  Bitcoin01Icon,
  Book01Icon,
  Bookmark01Icon,
  BrainIcon,
  Briefcase01Icon,
  Bug01Icon,
  Building01Icon,
  Calendar01Icon,
  Camera01Icon,
  Car01Icon,
  Chart01Icon,
  ChartUpIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  CloudIcon,
  Coffee01Icon,
  Coins01Icon,
  Comment01Icon,
  Compass01Icon,
  Copy01Icon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Database01Icon,
  Delete01Icon,
  DeliveryBox02Icon,
  Diamond01Icon,
  Dna01Icon,
  DollarCircleIcon,
  Download01Icon,
  Dumbbell01Icon,
  Edit01Icon,
  EyeIcon,
  FavouriteIcon,
  File01Icon,
  Files01Icon,
  FireIcon,
  Flag01Icon,
  FlashIcon,
  Folder01Icon,
  FolderLibraryIcon,
  FolderOpenIcon,
  GameController01Icon,
  GiftIcon,
  Globe02Icon,
  GridIcon,
  HelpCircleIcon,
  Home01Icon,
  Idea01Icon,
  Image01Icon,
  InboxIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Key01Icon,
  Layers01Icon,
  Leaf01Icon,
  Link01Icon,
  Location01Icon,
  LockIcon,
  Magnet01Icon,
  Mail01Icon,
  MapPinIcon,
  Medal01Icon,
  Message01Icon,
  Mic01Icon,
  Money01Icon,
  Moon02Icon,
  MusicNote01Icon,
  Navigation01Icon,
  Note01Icon,
  Notification01Icon,
  Package01Icon,
  PaintBrush01Icon,
  PieChartIcon,
  PinIcon,
  Pizza01Icon,
  PlayIcon,
  PresentationBarChart01Icon,
  PuzzleIcon,
  Radio01Icon,
  Refresh01Icon,
  Restaurant01Icon,
  Robot01Icon,
  RocketIcon,
  Route01Icon,
  Satellite01Icon,
  Scissor01Icon,
  Settings01Icon,
  Share01Icon,
  Shield01Icon,
  ShoppingBag01Icon,
  ShoppingCart01Icon,
  SourceCodeIcon,
  StarIcon,
  Store01Icon,
  Sun01Icon,
  Tag01Icon,
  TagsIcon,
  Target01Icon,
  TaskDone01Icon,
  Telescope01Icon,
  ThumbsUpIcon,
  Timer01Icon,
  Train01Icon,
  TruckIcon,
  Tv01Icon,
  Upload02Icon,
  UserGroupIcon,
  UserIcon,
  Video01Icon,
  Wallet01Icon,
  Watch01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// A curated, searchable set of HugeIcons a view can display in the sidebar. Each
// entry's `key` is the stable string persisted on `view.icon`; the icon itself
// is resolved client-side (icons are JS objects, not serialisable). `keywords`
// widen search matches beyond the label.
type ViewIconEntry = {
  key: string;
  label: string;
  icon: IconSvgElement;
  keywords?: string;
};

// The look a view falls back to when it has no chosen icon (`view.icon == null`).
export const DEFAULT_VIEW_ICON_KEY = "box";

export const VIEW_ICONS: readonly ViewIconEntry[] = [
  { key: "box", label: "Box", icon: DeliveryBox02Icon, keywords: "default package parcel" },
  { key: "folder", label: "Folder", icon: Folder01Icon, keywords: "directory" },
  { key: "folderopen", label: "Folder open", icon: FolderOpenIcon, keywords: "directory" },
  { key: "library", label: "Library", icon: FolderLibraryIcon, keywords: "folder collection" },
  { key: "files", label: "Files", icon: Files01Icon, keywords: "documents" },
  { key: "file", label: "File", icon: File01Icon, keywords: "document page" },
  { key: "note", label: "Note", icon: Note01Icon, keywords: "notes memo" },
  { key: "book", label: "Book", icon: Book01Icon, keywords: "read docs" },
  { key: "invoice", label: "Invoice", icon: Invoice01Icon, keywords: "bill receipt" },
  { key: "star", label: "Star", icon: StarIcon, keywords: "favourite important" },
  { key: "heart", label: "Heart", icon: FavouriteIcon, keywords: "favourite like love" },
  { key: "thumbsup", label: "Thumbs up", icon: ThumbsUpIcon, keywords: "like approve" },
  { key: "medal", label: "Medal", icon: Medal01Icon, keywords: "award prize win" },
  { key: "award", label: "Award", icon: Award01Icon, keywords: "medal prize" },
  { key: "tag", label: "Tag", icon: Tag01Icon, keywords: "label" },
  { key: "tags", label: "Tags", icon: TagsIcon, keywords: "labels" },
  { key: "bookmark", label: "Bookmark", icon: Bookmark01Icon, keywords: "save" },
  { key: "flag", label: "Flag", icon: Flag01Icon, keywords: "mark milestone" },
  { key: "pin", label: "Pin", icon: PinIcon, keywords: "pinned" },
  { key: "fire", label: "Fire", icon: FireIcon, keywords: "hot trending" },
  { key: "flash", label: "Flash", icon: FlashIcon, keywords: "spark energy bolt" },
  { key: "rocket", label: "Rocket", icon: RocketIcon, keywords: "launch ship" },
  { key: "target", label: "Target", icon: Target01Icon, keywords: "goal aim" },
  { key: "diamond", label: "Diamond", icon: Diamond01Icon, keywords: "gem premium" },
  { key: "gift", label: "Gift", icon: GiftIcon, keywords: "present reward" },
  { key: "image", label: "Image", icon: Image01Icon, keywords: "photo picture" },
  { key: "camera", label: "Camera", icon: Camera01Icon, keywords: "photo" },
  { key: "video", label: "Video", icon: Video01Icon, keywords: "movie film" },
  { key: "play", label: "Play", icon: PlayIcon, keywords: "media start" },
  { key: "music", label: "Music", icon: MusicNote01Icon, keywords: "audio song" },
  { key: "mic", label: "Mic", icon: Mic01Icon, keywords: "audio record voice" },
  { key: "radio", label: "Radio", icon: Radio01Icon, keywords: "broadcast" },
  { key: "tv", label: "TV", icon: Tv01Icon, keywords: "television screen" },
  { key: "calendar", label: "Calendar", icon: Calendar01Icon, keywords: "date schedule" },
  { key: "clock", label: "Clock", icon: Clock01Icon, keywords: "time recent" },
  { key: "timer", label: "Timer", icon: Timer01Icon, keywords: "stopwatch countdown" },
  { key: "watch", label: "Watch", icon: Watch01Icon, keywords: "time wrist" },
  { key: "refresh", label: "Refresh", icon: Refresh01Icon, keywords: "reload sync" },
  { key: "check", label: "Check", icon: CheckmarkCircle01Icon, keywords: "done complete" },
  { key: "task", label: "Task", icon: TaskDone01Icon, keywords: "todo checklist" },
  { key: "edit", label: "Edit", icon: Edit01Icon, keywords: "pencil write" },
  { key: "copy", label: "Copy", icon: Copy01Icon, keywords: "duplicate clone" },
  { key: "trash", label: "Trash", icon: Delete01Icon, keywords: "delete bin remove" },
  { key: "download", label: "Download", icon: Download01Icon, keywords: "save export" },
  { key: "upload", label: "Upload", icon: Upload02Icon, keywords: "import" },
  { key: "share", label: "Share", icon: Share01Icon, keywords: "send" },
  { key: "attachment", label: "Attachment", icon: Attachment01Icon, keywords: "clip file" },
  { key: "link", label: "Link", icon: Link01Icon, keywords: "url chain" },
  { key: "mail", label: "Mail", icon: Mail01Icon, keywords: "email message" },
  { key: "message", label: "Message", icon: Message01Icon, keywords: "chat bubble" },
  { key: "comment", label: "Comment", icon: Comment01Icon, keywords: "chat reply" },
  { key: "bell", label: "Bell", icon: Notification01Icon, keywords: "notification alert" },
  { key: "alert", label: "Alert", icon: Alert01Icon, keywords: "warning caution" },
  { key: "help", label: "Help", icon: HelpCircleIcon, keywords: "question support" },
  { key: "info", label: "Info", icon: InformationCircleIcon, keywords: "about details" },
  { key: "eye", label: "Eye", icon: EyeIcon, keywords: "view watch visible" },
  { key: "lock", label: "Lock", icon: LockIcon, keywords: "secure private" },
  { key: "shield", label: "Shield", icon: Shield01Icon, keywords: "security protect" },
  { key: "key", label: "Key", icon: Key01Icon, keywords: "access password" },
  { key: "settings", label: "Settings", icon: Settings01Icon, keywords: "gear config" },
  { key: "user", label: "User", icon: UserIcon, keywords: "person profile" },
  { key: "users", label: "Users", icon: UserGroupIcon, keywords: "people team group" },
  { key: "robot", label: "Robot", icon: Robot01Icon, keywords: "bot ai automation" },
  { key: "brain", label: "Brain", icon: BrainIcon, keywords: "mind think ai" },
  { key: "idea", label: "Idea", icon: Idea01Icon, keywords: "bulb light" },
  { key: "briefcase", label: "Briefcase", icon: Briefcase01Icon, keywords: "work business" },
  { key: "building", label: "Building", icon: Building01Icon, keywords: "office company" },
  { key: "store", label: "Store", icon: Store01Icon, keywords: "shop market" },
  { key: "home", label: "Home", icon: Home01Icon, keywords: "house" },
  { key: "chart", label: "Chart", icon: Chart01Icon, keywords: "graph stats" },
  { key: "chartup", label: "Chart up", icon: ChartUpIcon, keywords: "growth trend rise" },
  { key: "pie", label: "Pie chart", icon: PieChartIcon, keywords: "stats data" },
  { key: "analytics", label: "Analytics", icon: Analytics01Icon, keywords: "metrics data" },
  {
    key: "presentation",
    label: "Presentation",
    icon: PresentationBarChart01Icon,
    keywords: "slides report",
  },
  { key: "database", label: "Database", icon: Database01Icon, keywords: "storage data" },
  { key: "cloud", label: "Cloud", icon: CloudIcon, keywords: "storage" },
  { key: "wifi", label: "Wi-Fi", icon: Wifi01Icon, keywords: "network wireless signal" },
  { key: "globe", label: "Globe", icon: Globe02Icon, keywords: "world web public" },
  { key: "code", label: "Code", icon: SourceCodeIcon, keywords: "dev source" },
  { key: "bug", label: "Bug", icon: Bug01Icon, keywords: "issue defect" },
  { key: "wallet", label: "Wallet", icon: Wallet01Icon, keywords: "money finance" },
  { key: "card", label: "Card", icon: CreditCardIcon, keywords: "payment credit" },
  { key: "coins", label: "Coins", icon: Coins01Icon, keywords: "money crypto" },
  { key: "money", label: "Money", icon: Money01Icon, keywords: "cash finance" },
  { key: "dollar", label: "Dollar", icon: DollarCircleIcon, keywords: "money usd price" },
  { key: "bitcoin", label: "Bitcoin", icon: Bitcoin01Icon, keywords: "crypto btc" },
  { key: "cart", label: "Cart", icon: ShoppingCart01Icon, keywords: "shop buy" },
  { key: "bag", label: "Bag", icon: ShoppingBag01Icon, keywords: "shop purchase" },
  { key: "package", label: "Package", icon: Package01Icon, keywords: "box delivery parcel" },
  { key: "truck", label: "Truck", icon: TruckIcon, keywords: "delivery shipping" },
  { key: "plane", label: "Plane", icon: Airplane01Icon, keywords: "travel flight trip" },
  { key: "car", label: "Car", icon: Car01Icon, keywords: "vehicle drive" },
  { key: "train", label: "Train", icon: Train01Icon, keywords: "transport rail" },
  { key: "bicycle", label: "Bicycle", icon: Bicycle01Icon, keywords: "bike cycle" },
  { key: "location", label: "Location", icon: Location01Icon, keywords: "map place" },
  { key: "mappin", label: "Map pin", icon: MapPinIcon, keywords: "location place marker" },
  { key: "navigation", label: "Navigation", icon: Navigation01Icon, keywords: "direction compass" },
  { key: "route", label: "Route", icon: Route01Icon, keywords: "path trip journey" },
  { key: "compass", label: "Compass", icon: Compass01Icon, keywords: "explore navigate" },
  { key: "coffee", label: "Coffee", icon: Coffee01Icon, keywords: "cafe drink" },
  { key: "restaurant", label: "Restaurant", icon: Restaurant01Icon, keywords: "food dining" },
  { key: "pizza", label: "Pizza", icon: Pizza01Icon, keywords: "food" },
  { key: "game", label: "Game", icon: GameController01Icon, keywords: "play gaming" },
  { key: "dumbbell", label: "Dumbbell", icon: Dumbbell01Icon, keywords: "gym fitness workout" },
  { key: "leaf", label: "Leaf", icon: Leaf01Icon, keywords: "nature eco green" },
  { key: "sun", label: "Sun", icon: Sun01Icon, keywords: "light day weather" },
  { key: "moon", label: "Moon", icon: Moon02Icon, keywords: "night dark" },
  { key: "atom", label: "Atom", icon: Atom01Icon, keywords: "science physics" },
  { key: "dna", label: "DNA", icon: Dna01Icon, keywords: "biology gene science" },
  { key: "telescope", label: "Telescope", icon: Telescope01Icon, keywords: "space astronomy" },
  { key: "satellite", label: "Satellite", icon: Satellite01Icon, keywords: "space signal" },
  { key: "magnet", label: "Magnet", icon: Magnet01Icon, keywords: "attract" },
  { key: "scissors", label: "Scissors", icon: Scissor01Icon, keywords: "cut" },
  { key: "paint", label: "Paint", icon: PaintBrush01Icon, keywords: "design art brush" },
  { key: "puzzle", label: "Puzzle", icon: PuzzleIcon, keywords: "piece extension" },
  { key: "layers", label: "Layers", icon: Layers01Icon, keywords: "stack" },
  { key: "grid", label: "Grid", icon: GridIcon, keywords: "layout" },
  { key: "dashboard", label: "Dashboard", icon: DashboardSquare01Icon, keywords: "panel" },
  { key: "inbox", label: "Inbox", icon: InboxIcon, keywords: "incoming" },
  { key: "archive", label: "Archive", icon: Archive01Icon, keywords: "store old" },
];

const ICONS_BY_KEY = new Map(VIEW_ICONS.map((entry) => [entry.key, entry]));

// Resolve a stored key to its icon, falling back to the default box for null,
// undefined, or a key that's no longer in the registry.
export function viewIcon(key: string | null | undefined): IconSvgElement {
  const entry = (key && ICONS_BY_KEY.get(key)) || ICONS_BY_KEY.get(DEFAULT_VIEW_ICON_KEY)!;
  return entry.icon;
}

// A popover with a search box over a grid of icons. By default the trigger is an
// outline button showing the current selection; pass `trigger` to anchor the
// popover to any element (e.g. the view icon with a hover overlay). Picking an
// icon reports its key and closes the popover.
export function ViewIconPicker({
  value,
  onChange,
  disabled,
  trigger,
  align = "start",
}: {
  value: string | null | undefined;
  onChange: (key: string) => void;
  disabled?: boolean;
  trigger?: ReactElement;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedKey = value ?? DEFAULT_VIEW_ICON_KEY;
  const needle = query.trim().toLowerCase();
  const results = needle
    ? VIEW_ICONS.filter(
        (entry) =>
          entry.key.includes(needle) ||
          entry.label.toLowerCase().includes(needle) ||
          entry.keywords?.includes(needle),
      )
    : VIEW_ICONS;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger ? (
        <PopoverTrigger render={trigger} />
      ) : (
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label="Choose icon"
            />
          }
        >
          <HugeiconsIcon icon={viewIcon(selectedKey)} />
        </PopoverTrigger>
      )}
      <PopoverContent align={align} className="w-64 gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
        />
        <ScrollArea viewportClassName="max-h-56" scrollbarGutter>
          <div className="grid grid-cols-6 gap-1 p-0.5">
            {results.map((entry) => (
              <button
                key={entry.key}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                aria-pressed={entry.key === selectedKey}
                onClick={() => {
                  onChange(entry.key);
                  setOpen(false);
                }}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                  entry.key === selectedKey && "bg-primary/10 text-primary ring-1 ring-primary/40",
                )}
              >
                <HugeiconsIcon icon={entry.icon} className="size-[18px]" />
              </button>
            ))}
            {results.length === 0 && (
              <p className="col-span-6 py-6 text-center text-xs text-muted-foreground">
                No icons match “{query}”.
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
