import { Cloud, HardDrive, KeyRound, WifiOff } from "lucide-react";
import {
  DEFAULT_DOCUMENT_PARSER,
  listDocumentParsers,
  type DocumentParserId,
  type DocumentParserInfo,
} from "@/lib/parsers";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ParserSelectorProps {
  value: DocumentParserId;
  onChange: (id: DocumentParserId) => void;
  disabled?: boolean;
  compact?: boolean;
}

function statusIcon(info: DocumentParserInfo) {
  if (info.availability === "offline") return WifiOff;
  if (info.availability === "browser-local") return HardDrive;
  if (info.availability === "needs-config") return KeyRound;
  return Cloud;
}

function statusLabel(info: DocumentParserInfo): string {
  switch (info.availability) {
    case "ready":
      return "Ready";
    case "needs-config":
      return "Needs API key";
    case "browser-local":
      return "Local";
    case "offline":
      return "Offline";
    default:
      return info.availability;
  }
}

export function ParserSelector({
  value,
  onChange,
  disabled,
  compact,
}: ParserSelectorProps) {
  const parsers = listDocumentParsers();
  const selected = parsers.find((p) => p.id === value) ?? parsers[0];

  return (
    <div className={cn("space-y-2", compact && "space-y-1")}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          Document parser
        </label>
        {selected?.default || value === DEFAULT_DOCUMENT_PARSER ? (
          <Badge variant="secondary" className="text-[10px]">
            default
          </Badge>
        ) : null}
      </div>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as DocumentParserId)}
        disabled={disabled}
      >
        <SelectTrigger className="h-11 bg-card/80 text-left">
          <SelectValue placeholder="Select parser" />
        </SelectTrigger>
        <SelectContent className="max-w-[min(100vw-2rem,28rem)]">
          {parsers.map((p) => {
            const Icon = statusIcon(p);
            return (
              <SelectItem key={p.id} value={p.id} className="py-2.5">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {p.label}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({statusLabel(p)})
                    </span>
                  </span>
                  {!compact && (
                    <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2 pl-5">
                      {p.description}
                    </span>
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {selected && !compact && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {selected.description}
          {selected.envHints.length > 0 && selected.availability === "needs-config" && (
            <>
              {" "}
              Set{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                {selected.envHints[0]}
              </code>
              {selected.envHints.length > 1 ? " (and related vars)" : ""}.
            </>
          )}
        </p>
      )}
    </div>
  );
}
