import {
  Archive,
  Atom,
  Award,
  Banknote,
  Bell,
  Bike,
  Bitcoin,
  Bookmark,
  BookOpen,
  Bot,
  Box,
  Brain,
  BriefcaseBusiness,
  Bug,
  Building2,
  CalendarDays,
  Camera,
  Car,
  ChartColumn,
  ChartNoAxesColumnIncreasing,
  ChartNoAxesCombined,
  ChartPie,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Cloud,
  Code2,
  Coffee,
  Coins,
  Compass,
  Copy,
  CreditCard,
  Database,
  Diamond,
  Dna,
  Download,
  Dumbbell,
  Eye,
  File,
  Files,
  Flag,
  Flame,
  Folder,
  FolderOpen,
  Gamepad2,
  Gift,
  Globe2,
  Grid3X3,
  Heart,
  House,
  Image,
  Inbox,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Leaf,
  Library,
  Lightbulb,
  Link,
  ListChecks,
  LockKeyhole,
  Magnet,
  Mail,
  MapPin,
  MapPinned,
  Medal,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  Music2,
  Navigation,
  NotebookPen,
  Package,
  Paintbrush,
  Paperclip,
  Pencil,
  Pin,
  Pizza,
  Plane,
  Play,
  Presentation,
  Puzzle,
  Radio,
  ReceiptText,
  RefreshCw,
  Rocket,
  Route,
  Satellite,
  Scissors,
  Settings,
  Share2,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  Sun,
  Tag,
  Tags,
  Target,
  Telescope,
  ThumbsUp,
  Timer,
  TrainFront,
  Trash2,
  TriangleAlert,
  Truck,
  Tv,
  Upload,
  User,
  Users,
  Utensils,
  Video,
  WalletCards,
  Watch,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ViewColor } from "@keva/schema";
import { useState, type ReactElement } from "react";
import { VIEW_COLORS } from "./view-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ViewIconEntry = {
  key: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
};

export const DEFAULT_VIEW_ICON_KEY = "box";

export const VIEW_ICONS: readonly ViewIconEntry[] = [
  { key: "box", label: "Box", icon: Box, keywords: "default package parcel" },
  { key: "folder", label: "Folder", icon: Folder, keywords: "directory" },
  { key: "folderopen", label: "Folder open", icon: FolderOpen, keywords: "directory" },
  { key: "library", label: "Library", icon: Library, keywords: "folder collection" },
  { key: "files", label: "Files", icon: Files, keywords: "documents" },
  { key: "file", label: "File", icon: File, keywords: "document page" },
  { key: "note", label: "Note", icon: NotebookPen, keywords: "notes memo" },
  { key: "book", label: "Book", icon: BookOpen, keywords: "read docs" },
  { key: "invoice", label: "Invoice", icon: ReceiptText, keywords: "bill receipt" },
  { key: "star", label: "Star", icon: Star, keywords: "favourite important" },
  { key: "heart", label: "Heart", icon: Heart, keywords: "favourite like love" },
  { key: "thumbsup", label: "Thumbs up", icon: ThumbsUp, keywords: "like approve" },
  { key: "medal", label: "Medal", icon: Medal, keywords: "award prize win" },
  { key: "award", label: "Award", icon: Award, keywords: "medal prize" },
  { key: "tag", label: "Tag", icon: Tag, keywords: "label" },
  { key: "tags", label: "Tags", icon: Tags, keywords: "labels" },
  { key: "bookmark", label: "Bookmark", icon: Bookmark, keywords: "save" },
  { key: "flag", label: "Flag", icon: Flag, keywords: "mark milestone" },
  { key: "pin", label: "Pin", icon: Pin, keywords: "pinned" },
  { key: "fire", label: "Fire", icon: Flame, keywords: "hot trending" },
  { key: "flash", label: "Flash", icon: Zap, keywords: "spark energy bolt" },
  { key: "rocket", label: "Rocket", icon: Rocket, keywords: "launch ship" },
  { key: "target", label: "Target", icon: Target, keywords: "goal aim" },
  { key: "diamond", label: "Diamond", icon: Diamond, keywords: "gem premium" },
  { key: "gift", label: "Gift", icon: Gift, keywords: "present reward" },
  { key: "image", label: "Image", icon: Image, keywords: "photo picture" },
  { key: "camera", label: "Camera", icon: Camera, keywords: "photo" },
  { key: "video", label: "Video", icon: Video, keywords: "movie film" },
  { key: "play", label: "Play", icon: Play, keywords: "media start" },
  { key: "music", label: "Music", icon: Music2, keywords: "audio song" },
  { key: "mic", label: "Mic", icon: Mic, keywords: "audio record voice" },
  { key: "radio", label: "Radio", icon: Radio, keywords: "broadcast" },
  { key: "tv", label: "TV", icon: Tv, keywords: "television screen" },
  { key: "calendar", label: "Calendar", icon: CalendarDays, keywords: "date schedule" },
  { key: "clock", label: "Clock", icon: Clock3, keywords: "time recent" },
  { key: "timer", label: "Timer", icon: Timer, keywords: "stopwatch countdown" },
  { key: "watch", label: "Watch", icon: Watch, keywords: "time wrist" },
  { key: "refresh", label: "Refresh", icon: RefreshCw, keywords: "reload sync" },
  { key: "check", label: "Check", icon: CircleCheck, keywords: "done complete" },
  { key: "task", label: "Task", icon: ListChecks, keywords: "todo checklist" },
  { key: "edit", label: "Edit", icon: Pencil, keywords: "pencil write" },
  { key: "copy", label: "Copy", icon: Copy, keywords: "duplicate clone" },
  { key: "trash", label: "Trash", icon: Trash2, keywords: "delete bin remove" },
  { key: "download", label: "Download", icon: Download, keywords: "save export" },
  { key: "upload", label: "Upload", icon: Upload, keywords: "import" },
  { key: "share", label: "Share", icon: Share2, keywords: "send" },
  { key: "attachment", label: "Attachment", icon: Paperclip, keywords: "clip file" },
  { key: "link", label: "Link", icon: Link, keywords: "url chain" },
  { key: "mail", label: "Mail", icon: Mail, keywords: "email message" },
  { key: "message", label: "Message", icon: MessageSquare, keywords: "chat bubble" },
  { key: "comment", label: "Comment", icon: MessageCircle, keywords: "chat reply" },
  { key: "bell", label: "Bell", icon: Bell, keywords: "notification alert" },
  { key: "alert", label: "Alert", icon: TriangleAlert, keywords: "warning caution" },
  { key: "help", label: "Help", icon: CircleHelp, keywords: "question support" },
  { key: "info", label: "Info", icon: Info, keywords: "about details" },
  { key: "eye", label: "Eye", icon: Eye, keywords: "view watch visible" },
  { key: "lock", label: "Lock", icon: LockKeyhole, keywords: "secure private" },
  { key: "shield", label: "Shield", icon: Shield, keywords: "security protect" },
  { key: "key", label: "Key", icon: KeyRound, keywords: "access password" },
  { key: "settings", label: "Settings", icon: Settings, keywords: "gear config" },
  { key: "user", label: "User", icon: User, keywords: "person profile" },
  { key: "users", label: "Users", icon: Users, keywords: "people team group" },
  { key: "robot", label: "Robot", icon: Bot, keywords: "bot ai automation" },
  { key: "brain", label: "Brain", icon: Brain, keywords: "mind think ai" },
  { key: "idea", label: "Idea", icon: Lightbulb, keywords: "bulb light" },
  { key: "briefcase", label: "Briefcase", icon: BriefcaseBusiness, keywords: "work business" },
  { key: "building", label: "Building", icon: Building2, keywords: "office company" },
  { key: "store", label: "Store", icon: Store, keywords: "shop market" },
  { key: "home", label: "Home", icon: House, keywords: "house" },
  { key: "chart", label: "Chart", icon: ChartColumn, keywords: "graph stats" },
  {
    key: "chartup",
    label: "Chart up",
    icon: ChartNoAxesColumnIncreasing,
    keywords: "growth trend rise",
  },
  { key: "pie", label: "Pie chart", icon: ChartPie, keywords: "stats data" },
  { key: "analytics", label: "Analytics", icon: ChartNoAxesCombined, keywords: "metrics data" },
  {
    key: "presentation",
    label: "Presentation",
    icon: Presentation,
    keywords: "slides report",
  },
  { key: "database", label: "Database", icon: Database, keywords: "storage data" },
  { key: "cloud", label: "Cloud", icon: Cloud, keywords: "storage" },
  { key: "wifi", label: "Wi-Fi", icon: Wifi, keywords: "network wireless signal" },
  { key: "globe", label: "Globe", icon: Globe2, keywords: "world web public" },
  { key: "code", label: "Code", icon: Code2, keywords: "dev source" },
  { key: "bug", label: "Bug", icon: Bug, keywords: "issue defect" },
  { key: "wallet", label: "Wallet", icon: WalletCards, keywords: "money finance" },
  { key: "card", label: "Card", icon: CreditCard, keywords: "payment credit" },
  { key: "coins", label: "Coins", icon: Coins, keywords: "money crypto" },
  { key: "money", label: "Money", icon: Banknote, keywords: "cash finance" },
  { key: "dollar", label: "Dollar", icon: CircleDollarSign, keywords: "money usd price" },
  { key: "bitcoin", label: "Bitcoin", icon: Bitcoin, keywords: "crypto btc" },
  { key: "cart", label: "Cart", icon: ShoppingCart, keywords: "shop buy" },
  { key: "bag", label: "Bag", icon: ShoppingBag, keywords: "shop purchase" },
  { key: "package", label: "Package", icon: Package, keywords: "box delivery parcel" },
  { key: "truck", label: "Truck", icon: Truck, keywords: "delivery shipping" },
  { key: "plane", label: "Plane", icon: Plane, keywords: "travel flight trip" },
  { key: "car", label: "Car", icon: Car, keywords: "vehicle drive" },
  { key: "train", label: "Train", icon: TrainFront, keywords: "transport rail" },
  { key: "bicycle", label: "Bicycle", icon: Bike, keywords: "bike cycle" },
  { key: "location", label: "Location", icon: MapPinned, keywords: "map place" },
  { key: "mappin", label: "Map pin", icon: MapPin, keywords: "location place marker" },
  { key: "navigation", label: "Navigation", icon: Navigation, keywords: "direction compass" },
  { key: "route", label: "Route", icon: Route, keywords: "path trip journey" },
  { key: "compass", label: "Compass", icon: Compass, keywords: "explore navigate" },
  { key: "coffee", label: "Coffee", icon: Coffee, keywords: "cafe drink" },
  { key: "restaurant", label: "Restaurant", icon: Utensils, keywords: "food dining" },
  { key: "pizza", label: "Pizza", icon: Pizza, keywords: "food" },
  { key: "game", label: "Game", icon: Gamepad2, keywords: "play gaming" },
  { key: "dumbbell", label: "Dumbbell", icon: Dumbbell, keywords: "gym fitness workout" },
  { key: "leaf", label: "Leaf", icon: Leaf, keywords: "nature eco green" },
  { key: "sun", label: "Sun", icon: Sun, keywords: "light day weather" },
  { key: "moon", label: "Moon", icon: Moon, keywords: "night dark" },
  { key: "atom", label: "Atom", icon: Atom, keywords: "science physics" },
  { key: "dna", label: "DNA", icon: Dna, keywords: "biology gene science" },
  { key: "telescope", label: "Telescope", icon: Telescope, keywords: "space astronomy" },
  { key: "satellite", label: "Satellite", icon: Satellite, keywords: "space signal" },
  { key: "magnet", label: "Magnet", icon: Magnet, keywords: "attract" },
  { key: "scissors", label: "Scissors", icon: Scissors, keywords: "cut" },
  { key: "paint", label: "Paint", icon: Paintbrush, keywords: "design art brush" },
  { key: "puzzle", label: "Puzzle", icon: Puzzle, keywords: "piece extension" },
  { key: "layers", label: "Layers", icon: Layers3, keywords: "stack" },
  { key: "grid", label: "Grid", icon: Grid3X3, keywords: "layout" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: "panel" },
  { key: "inbox", label: "Inbox", icon: Inbox, keywords: "incoming" },
  { key: "archive", label: "Archive", icon: Archive, keywords: "store old" },
];

const ICONS_BY_KEY = new Map(VIEW_ICONS.map((entry) => [entry.key, entry]));

export function viewIcon(key: string | null | undefined): LucideIcon {
  const entry = (key && ICONS_BY_KEY.get(key)) || ICONS_BY_KEY.get(DEFAULT_VIEW_ICON_KEY)!;
  return entry.icon;
}

export function ViewIconPicker({
  value,
  onChange,
  color,
  onColorChange,
  disabled,
  trigger,
  align = "start",
}: {
  value: string | null | undefined;
  onChange: (key: string) => void;
  color?: ViewColor | null | undefined;
  onColorChange?: (color: ViewColor) => void;
  disabled?: boolean;
  trigger?: ReactElement;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedKey = value ?? DEFAULT_VIEW_ICON_KEY;
  const SelectedIcon = viewIcon(selectedKey);
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
          <SelectedIcon />
        </PopoverTrigger>
      )}
      <PopoverContent align={align} className="w-64 gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
        />
        {onColorChange && (
          <div className="flex items-center justify-between gap-1 px-0.5" aria-label="View color">
            {VIEW_COLORS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                aria-pressed={entry.key === color}
                onClick={() => onColorChange(entry.key)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md hover:bg-muted",
                  entry.key === color && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
                )}
              >
                <span className={cn("size-3.5 rounded-full", entry.className)} />
              </button>
            ))}
          </div>
        )}
        <ScrollArea viewportClassName="max-h-56" scrollbarGutter>
          <div className="grid grid-cols-6 gap-1 p-0.5">
            {results.map((entry) => {
              const Icon = entry.icon;
              return (
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
                    entry.key === selectedKey &&
                      "bg-primary/10 text-primary ring-1 ring-primary/40",
                  )}
                >
                  <Icon className="size-[18px]" />
                </button>
              );
            })}
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
