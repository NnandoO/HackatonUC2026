import Image from "next/image";
import { cn } from "@/lib/utils";

export function LogoAngibell({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        "block size-12 shrink-0 overflow-hidden rounded-full border-[1.5px] border-tinta/70 bg-[#ffedbb]",
        className
      )}
    >
      <Image
        src="/logo.png"
        alt="Angibell Creaciones"
        width={500}
        height={500}
        priority={priority}
        className="size-full scale-[0.92] object-contain"
      />
    </span>
  );
}
