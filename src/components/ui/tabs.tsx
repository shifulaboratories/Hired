"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        // w-fit with four tabs is wider than a phone, and an inline-flex that
        // does not fit pushes the whole document sideways. Capping it at the
        // container and letting the strip scroll keeps every tab reachable
        // without the page moving; scrollbar-none because a visible bar under
        // a 36px control is thicker than the control's own padding.
        // justify-start, never center: a centred row that overflows spills
        // past BOTH edges, and a scroll container cannot scroll to negative
        // offsets, so the first tab was unreachable on a phone. w-fit means
        // start and center look identical whenever the row does fit.
        "bg-muted/60 text-muted-foreground no-scrollbar inline-flex h-auto w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-1 md:h-9",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // h-11 on mobile rather than a ::after hit area: the list scrolls, and
        // a scroll container clips a pseudo-element that reaches outside it.
        "touch-target inline-flex h-11 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all duration-200 outline-none md:h-auto",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-btn",
        "focus-visible:ring-ring/40 focus-visible:ring-[3px]",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("flex-1 outline-none data-[state=active]:animate-in-up", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
