import {
  Download,
  FileJson,
  FileSpreadsheet,
  Redo2,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CATEGORIES, type TransactionCategory } from "@/lib/types";

interface ToolbarProps {
  query: string;
  onQueryChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  includeNotes: boolean;
  onIncludeNotesChange: (v: boolean) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onReset: () => void;
  resultCount: number;
  totalCount: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function Toolbar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  includeNotes,
  onIncludeNotesChange,
  onExportCsv,
  onExportJson,
  onReset,
  resultCount,
  totalCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col xs:flex-row sm:flex-row gap-1.5 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search description, date, amount…"
            className="pl-8 h-8 text-sm bg-card/80"
            aria-label="Search transactions"
          />
        </div>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-full sm:w-[150px] h-8 text-xs bg-card/80">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c: TransactionCategory) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground mr-0.5 tabular-nums">
          {resultCount}/{totalCount}
        </p>
        <div className="flex items-center rounded-full border border-border/70 bg-card/70 p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 rounded-full"
                disabled={!canUndo}
                onClick={onUndo}
                aria-label="Undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 rounded-full"
                disabled={!canRedo}
                onClick={onRedo}
                aria-label="Redo"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-2.5 py-1">
          <Switch
            id="include-notes"
            checked={includeNotes}
            onCheckedChange={onIncludeNotesChange}
            className="scale-90"
          />
          <Label htmlFor="include-notes" className="text-[11px] cursor-pointer">
            Notes
          </Label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Download data</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportCsv}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportJson}>
              <FileJson className="mr-2 h-4 w-4" />
              JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full h-8 text-xs text-muted-foreground"
          onClick={onReset}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          New
        </Button>
      </div>
    </div>
  );
}
