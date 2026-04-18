import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

const MAP: Record<Severity, { bg: string; fg: string; label: string }> = {
  high:   { bg: "bg-sev-high",  fg: "text-accent-fg",  label: "HIGH" },
  medium: { bg: "bg-sev-med",   fg: "text-accent-fg",  label: "MED"  },
  low:    { bg: "bg-sev-low",   fg: "text-bg",         label: "LOW"  },
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const { bg, fg, label } = MAP[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
        bg,
        fg,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function severityBarClass(severity: Severity | null | undefined): string {
  switch (severity) {
    case "high":   return "bg-sev-high";
    case "medium": return "bg-sev-med";
    case "low":    return "bg-sev-low";
    default:       return "bg-sev-none";
  }
}
