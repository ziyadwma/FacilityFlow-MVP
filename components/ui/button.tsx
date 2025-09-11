import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./utils";

type Props = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  variant?: "default" | "outline";
  size?: "sm" | "md";
};

export function Button({ className, variant = "default", size = "md", ...props }: Props) {
  const base = "rounded-md font-medium transition border";
  const sizes = size === "sm" ? "text-sm px-3 py-1.5" : "px-4 py-2";
  const styles =
    variant === "outline"
      ? "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
      : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700";
  return <button className={cn(base, sizes, styles, className)} {...props} />;
}
