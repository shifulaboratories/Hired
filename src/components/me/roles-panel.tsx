"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  DownloadIcon,
  MapPinIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/page-header";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { dateRange, truncate } from "@/lib/utils";

type RoleCard = {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: string;
  tags: string[];
  backgroundLength: number;
  highlightCount: number;
};

export function RolesPanel({ roles }: { roles: RoleCard[] }) {
  if (roles.length === 0) {
    return (
      <EmptyState
        icon={BriefcaseIcon}
        title="Nothing on file yet"
        description="Paste in a resume you already have and it fills this in for you — jobs, dates, bullets. Or add one job by hand and dump everything you remember about it underneath."
        action={
          // Links rather than the dialogs themselves: both are already mounted
          // by the page above and open on a URL parameter, which is what the
          // setup strip links to as well. One button that works two ways beats
          // a second copy of a dialog.
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/me?import=1">
                <DownloadIcon /> Paste a resume
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/me?new=role">
                <PlusIcon /> Add a job by hand
              </Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {roles.map((role) => (
        <StaggerItem key={role.id}>
          <Lift>
            <Link href={`/me/${role.id}`} className="block h-full">
              <Card className="group relative h-full overflow-hidden transition-shadow duration-200 ease-[var(--ease-settle)] hover:shadow-raised">
                <CardContent className="relative flex h-full flex-col pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold tracking-tight">
                        {role.title}
                      </div>
                      <div className="text-muted-foreground truncate text-sm font-medium">{role.company}</div>
                    </div>
                    {role.isCurrent && (
                      <Badge variant="success" className="shrink-0">
                        Current
                      </Badge>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>{dateRange(role.startDate, role.endDate, role.isCurrent)}</span>
                    {role.location && (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-3" />
                        {role.location}
                      </span>
                    )}
                  </div>

                  {role.summary && (
                    <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                      {truncate(role.summary, 130)}
                    </p>
                  )}

                  {role.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {role.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-4 pt-5 text-xs">
                    <span className="flex items-center gap-1.5">
                      <SparklesIcon className="text-muted-foreground size-3" />
                      <span className="font-medium tabular-nums">{role.highlightCount}</span>
                      <span className="text-muted-foreground">highlights</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatBackground(role.backgroundLength)}
                    </span>
                    <ArrowRightIcon className="text-muted-foreground ml-auto size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </Lift>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function formatBackground(length: number) {
  if (length === 0) return "nothing written yet";
  const words = Math.round(length / 5.5);
  if (words < 1000) return `${words} words`;
  return `${(words / 1000).toFixed(1)}k words`;
}
