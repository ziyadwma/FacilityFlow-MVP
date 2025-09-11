import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./utils";

export function Badge({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLSpanElement>>) {
  return <span className={cn("inline-block text-xs px-2 py-0.5 rounded-md", className)} {...props} />;
}
