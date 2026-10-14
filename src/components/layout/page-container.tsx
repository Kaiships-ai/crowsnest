import { cn } from "@/lib/utils";

/**
 * The one page gutter. Every route body wraps its content in this instead of
 * repeating `mx-auto max-w-[1120px] p-6`, so the reading width and the
 * mobile/desktop padding step are decided in one place.
 *
 * `narrow` is for single-column forms (Persona). `full` drops the max-width
 * for the two routes that own their own horizontal scroller (Feed's grid,
 * Channels' kanban).
 */
export function PageContainer({
  size = "default",
  className,
  children,
}: {
  size?: "default" | "narrow" | "full";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-4 sm:px-6 sm:py-6",
        size === "default" && "max-w-[1120px]",
        size === "narrow" && "max-w-[720px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
