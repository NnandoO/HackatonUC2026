"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      className="rotulo text-[11px]"
      onClick={async () => {
        await fetch("/api/panel/logout", { method: "POST" });
        router.refresh();
      }}
    >
      Salir
    </Button>
  );
}
