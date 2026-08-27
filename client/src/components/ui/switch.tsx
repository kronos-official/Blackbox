import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  dir,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      dir={dir ?? "rtl"}
      className={cn(
        "peer inline-flex h-5 w-10 shrink-0 items-center rounded-full border border-transparent bg-slate-700/90 p-0.5 shadow-inner transition-colors duration-200 data-[state=checked]:bg-cyan-300 data-[state=unchecked]:bg-slate-700/90 focus-visible:border-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-200/45 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 data-[state=checked]:-translate-x-[18px] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
