import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./utils";

export function Card({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("bg-white rounded-xl border shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("p-4 border-b", className)} {...props} />;
}
export function CardTitle({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLHeadingElement>>) {
  return <h3 className={cn("text-lg font-semibold", className)} {...props} />;
}
export function CardContent({ className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("p-4", className)} {...props} />;
}
