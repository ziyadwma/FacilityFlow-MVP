import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./utils";

export function Avatar({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center", className)} {...props} />;
}
export function AvatarFallback({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLSpanElement>>) {
  return <span className={cn("text-xs font-medium text-gray-700", className)} {...props} />;
}

