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
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col sm:flex-row gap-2 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search description, date, amount…"
            className="pl-9 h-10 bg-card/80"
            aria-label="Search transactions"
          />
        </div>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-full sm:w-[180px] h-10 bg-card/80">
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

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground mr-1 tabular-nums">
          {resultCount} / {totalCount}
        </p>
        <div className="flex items-center rounded-full border border-border/70 bg-card/70 p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full"
                disabled={!canUndo}
                onClick={onUndo}
                aria-label="Undo"
              >
                <Undo2 className="h-4 w-4" />
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
                className="h-8 w-8 rounded-full"
                disabled={!canRedo}
                onClick={onRedo}
                aria-label="Redo"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5">
          <Switch
            id="include-notes"
            checked={includeNotes}
            onCheckedChange={onIncludeNotesChange}
          />
          <Label htmlFor="include-notes" className="text-xs cursor-pointer">
            Include notes
          </Label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="rounded-full">
              <Download className="mr-2 h-4 w-4" />
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
        <Button variant="outline" className="rounded-full" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          New file
        </Button>
      </div>
    </div>
  );
}
