import { cn } from "@/lib/utils";

export function Num({
  value,
  prefix,
  suffix,
  className,
}: {
  value: number | string;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
