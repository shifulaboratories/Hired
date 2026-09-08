"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CircleUserRoundIcon,
  Building2Icon,
  ChevronDownIcon,
  KanbanIcon,
  ListChecksIcon,
  Trash2Icon,
  LogOutIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/command-palette";
import { SHORTCUTS, useKeyboardNav } from "@/hooks/use-keyboard-nav";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HiredMark } from "@/components/hired-mark";
import { Notifications, type Notice } from "@/components/notifications";
import { UserAvatar } from "@/components/user-avatar";
import { logoutAction } from "@/server/actions";
import { MANUAL_URL } from "@/lib/links";

// Navigation only. Settings and Admin are account actions, so they live in the
// profile menu at the top right rather than in the rail.
//
// The words here are the ones the welcome tour teaches, and they were not.
// The tour's second card says "every job you apply to is a card, drag it along"
// — and then the rail read "Pipeline", a word the tour never uses, next to
// "CRM", a three-letter acronym this audience has never met. Labels only: the
// routes stay /applications and /crm, so every link, saved view and bookmark
// still works, and the command palette carries the old words as search aliases
// for anyone who does know them.
//
// CRM is the one entry with children: it is two peer screens (companies and
// people), and reaching the second one used to require landing on the first
// and finding the tabs. The rail names both — but folded away until asked for,
// because a permanently open branch makes a five-item rail read as seven and
// buries Pipeline. The parent is still a link to /crm; the chevron beside it is
// what opens the branch. In the collapsed rail the children fold into the
// icon's tooltip-covered single link, and the tabs on the page take over.
type NavItem = {
  href: string;
  label: string;
  icon: typeof KanbanIcon;
  children?: { href: string; label: string }[];
};

const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: ListChecksIcon },
  { href: "/me", label: "Me", icon: CircleUserRoundIcon },
  {
    href: "/crm",
    label: "People",
    icon: Building2Icon,
    children: [
      { href: "/crm/companies", label: "Companies" },
      { href: "/crm/contacts", label: "Contacts" },
    ],
  },
  { href: "/applications", label: "Board", icon: KanbanIcon },
];

// The rail remembers whether you collapsed it. Read after mount so the server
// and the first client render agree.
const COLLAPSE_KEY = "hired:sidebar-collapsed";

/** Which nav branches are open. Same reasoning as the rail's own collapse. */
const BRANCH_KEY = "hired:nav-open-branches";

export type ShellUser = { name: string; email: string; role: string; photo: string };

export function Shell({
  children,
  notices,
  user,
}: {
  children: React.ReactNode;
  notices: Notice[];
  user: ShellUser;
}) {
  const canAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // j/k through a list, / to search, n to create, ? for the sheet. One
  // implementation for every screen: a row opts in by tagging its link.
  const { showHelp, setShowHelp } = useKeyboardNav();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openBranches, setOpenBranches] = useState<string[]>([]);

  // Navigating is the reason the drawer was opened, so arriving closes it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    try {
      const stored = JSON.parse(window.localStorage.getItem(BRANCH_KEY) ?? "[]");
      if (Array.isArray(stored)) setOpenBranches(stored.filter((v) => typeof v === "string"));
    } catch {
      // A corrupt value is not worth a broken sidebar; start closed.
    }
  }, []);

  const toggleBranch = (href: string) => {
    setOpenBranches((current) => {
      const next = current.includes(href)
        ? current.filter((value) => value !== href)
        : [...current, href];
      window.localStorage.setItem(BRANCH_KEY, JSON.stringify(next));
      return next;
    });
  };

  /**
   * Being inside a branch opens it, whatever was stored. Landing on
   * /crm/contacts from a link and finding the rail insisting Contacts is
   * hidden would be the rail arguing with the page.
   */
  const branchOpen = (href: string) =>
    openBranches.includes(href) || pathname.startsWith(href);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-svh">
      {/* Rail */}
      <aside
        className={cn(
          "bg-sidebar sticky top-0 z-30 hidden h-svh shrink-0 flex-col border-r transition-[width] duration-200 md:flex",
          collapsed ? "w-[4.5rem]" : "w-[15rem]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center gap-2.5",
            collapsed ? "justify-center px-2" : "px-5",
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  aria-label="Expand sidebar"
                  className="hover:bg-accent group relative flex size-9 items-center justify-center rounded-lg transition-colors"
                >
                  <HiredMark size={26} className="transition-opacity group-hover:opacity-0" />
                  <PanelLeftOpenIcon className="text-muted-foreground absolute size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <HiredMark size={26} className="shrink-0" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[15px] font-semibold tracking-tight">Hired</div>
                {/* 10.5px, not 11px: the line is five pixels too wide for this
                    rail at 11 and ellipsises to "on the rec…", and a clipped
                    tagline is worse than a slightly smaller one. */}
                <div className="text-muted-foreground truncate text-[10.5px] tracking-[-0.004em]">
                  Your career, on the record
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground -mr-1.5 ml-auto"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
              >
                <PanelLeftCloseIcon />
              </Button>
            </>
          )}
        </div>

        <div className={cn("pb-2", collapsed ? "px-2" : "px-3")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent bg-card flex w-full items-center justify-center rounded-md border py-2 transition-colors"
                  aria-label="Search"
                >
                  <SearchIcon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Search · ⌘K</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setPaletteOpen(true)}
              className="text-muted-foreground hover:text-foreground hover:bg-accent bg-card flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] transition-colors"
            >
              <SearchIcon className="size-3.5" />
              <span>Search…</span>
              <kbd className="bg-muted text-muted-foreground ml-auto rounded px-1.5 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </button>
          )}
        </div>

        <nav className={cn("flex flex-1 flex-col gap-0.5", collapsed ? "px-2" : "px-3")}>
          {NAV.map((item) => {
            const active = isActive(item.href);
            const link = (
              <Link
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="bg-accent absolute inset-0 rounded-lg"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <item.icon
                  className={cn(
                    "relative size-4 shrink-0 transition-colors",
                    active ? "text-primary" : "group-hover:text-foreground",
                  )}
                />
                {!collapsed && <span className="relative">{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            if (!item.children) return <div key={item.href}>{link}</div>;

            const open = branchOpen(item.href);
            const branchId = `nav-branch-${item.href.replace(/\W/g, "")}`;
            return (
              <div key={item.href} className="flex flex-col gap-0.5">
                {/* The chevron sits over the link rather than inside it: a
                    button nested in an anchor is invalid, and the parent has to
                    stay a real link — clicking CRM should go to CRM, not just
                    unfold it. */}
                <div className="relative">
                  {link}
                  <button
                    type="button"
                    onClick={() => toggleBranch(item.href)}
                    aria-expanded={open}
                    aria-controls={branchId}
                    aria-label={`${open ? "Hide" : "Show"} ${item.label} sections`}
                    className="text-faint hover:bg-accent hover:text-foreground absolute inset-y-1 right-1 flex w-7 items-center justify-center rounded-md transition-colors"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 transition-transform duration-200",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                </div>

                <div id={branchId} hidden={!open} className="flex flex-col gap-0.5">
                  {item.children.map((child) => {
                    const childActive = pathname.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        aria-current={childActive ? "page" : undefined}
                        className={cn(
                          // Indented to sit under the parent's label, not its icon,
                          // so the hierarchy reads at a glance.
                          "ml-[2.4rem] flex items-center rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                          childActive
                            ? "bg-accent/70 text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-2 border-b px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-9"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <MenuIcon />
            </Button>
            {/* Five unlabelled icons told you nothing about where you were.
                The drawer holds the navigation; the bar just names the page. */}
            <span className="truncate text-[15px] font-semibold tracking-tight">
              {NAV.find((item) => isActive(item.href))?.label ?? "Hired"}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-9 md:hidden"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
            >
              <SearchIcon />
            </Button>
            <Notifications items={notices} />
            <ProfileMenu user={user} canAdmin={canAdmin} />
          </div>
        </header>

        <MobileNav
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          isActive={isActive}
          canAdmin={canAdmin}
          branchOpen={branchOpen}
          onToggleBranch={toggleBranch}
          onSearch={() => {
            setDrawerOpen(false);
            setPaletteOpen(true);
          }}
        />

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard</DialogTitle>
            <DialogDescription className="sr-only">
              The keys this app answers to.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.keys} className="flex items-center gap-3 text-[13px]">
                <kbd className="bg-inset rounded-control min-w-14 px-1.5 py-0.5 text-center font-mono text-[11.5px]">
                  {shortcut.keys}
                </kbd>
                <span className="text-muted-foreground">{shortcut.what}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The phone's navigation. Everything the desktop rail holds, plus the account
 * links that live in the profile menu — because on a phone the profile menu is
 * a 28px avatar and "where is Settings" should not depend on finding it.
 */
function MobileNav({
  open,
  onOpenChange,
  isActive,
  canAdmin,
  onSearch,
  branchOpen,
  onToggleBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isActive: (href: string) => boolean;
  canAdmin: boolean;
  onSearch: () => void;
  /** Shared with the rail so the drawer and the sidebar never disagree. */
  branchOpen: (href: string) => boolean;
  onToggleBranch: (href: string) => void;
}) {
  // One Docs, and it is the manual. The in-app page that used to sit beside it
  // said the same things from the same tools array, and the menu should not ask
  // anybody to pick between two answers to one question. It lives on another
  // origin, so it opens in its own tab and the arrow says so.
  const secondary = [
    { href: "/archive", label: "Archive", icon: Trash2Icon, external: false },
    { href: MANUAL_URL, label: "Docs", icon: BookOpenIcon, external: true },
    { href: "/settings", label: "Settings", icon: SettingsIcon, external: false },
    ...(canAdmin
      ? [{ href: "/settings/admin", label: "Admin", icon: ShieldIcon, external: false }]
      : []),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showClose={false} className="gap-0 p-0 md:hidden">
        <SheetTitle className="sr-only">Menu</SheetTitle>

        <div className="flex h-16 items-center gap-2.5 px-5">
          <HiredMark size={26} className="shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-semibold tracking-tight">Hired</div>
            <div className="text-muted-foreground truncate text-[10.5px] tracking-[-0.004em]">
              Your career, on the record
            </div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={onSearch}
            className="text-muted-foreground hover:text-foreground hover:bg-accent bg-card flex h-11 w-full items-center gap-2 rounded-md border px-3 text-[14px] transition-colors"
          >
            <SearchIcon className="size-4" />
            <span>Search…</span>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const open = item.children ? branchOpen(item.href) : false;
            const branchId = `drawer-branch-${item.href.replace(/\W/g, "")}`;
            return (
              <div key={item.href} className="flex flex-col gap-0.5">
                <div className="relative">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors",
                      active ? "bg-accent text-foreground" : "text-muted-foreground",
                      item.children && "pr-12",
                    )}
                  >
                    <item.icon className={cn("size-4 shrink-0", active && "text-primary")} />
                    <span>{item.label}</span>
                  </Link>
                  {item.children && (
                    <button
                      type="button"
                      onClick={() => onToggleBranch(item.href)}
                      aria-expanded={open}
                      aria-controls={branchId}
                      aria-label={`${open ? "Hide" : "Show"} ${item.label} sections`}
                      className="text-faint hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-lg transition-colors"
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-4 transition-transform duration-200",
                          open && "rotate-180",
                        )}
                      />
                    </button>
                  )}
                </div>

                {item.children && (
                  <div id={branchId} hidden={!open} className="flex flex-col gap-0.5">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="text-muted-foreground ml-10 flex h-9 items-center rounded-lg px-3 text-[13px] font-medium transition-colors"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-0.5 border-t px-3 py-3">
          {secondary.map((item) => {
            const className =
              "text-muted-foreground flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors";
            const body = (
              <>
                <item.icon className="size-4 shrink-0" />
                <span>{item.label}</span>
                {item.external && <ArrowUpRightIcon className="ml-auto size-3.5 shrink-0" />}
              </>
            );
            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className={className}
              >
                {body}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                {body}
              </Link>
            );
          })}
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-muted-foreground flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors"
            >
              <LogOutIcon className="size-4 shrink-0" />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileMenu({ user, canAdmin }: { user: ShellUser; canAdmin: boolean }) {
  const roleLabel = user.role === "SUPER_ADMIN" ? "Owner" : canAdmin ? "Admin" : "Member";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="hover:bg-accent touch-target flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 transition-colors"
          aria-label="Account menu"
        >
          <UserAvatar name={user.name} email={user.email} photo={user.photo} size={28} />
          <span className="hidden max-w-[10rem] truncate text-[13px] font-medium sm:block">
            {user.name || user.email}
          </span>
          <ChevronDownIcon className="text-muted-foreground size-3.5" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <UserAvatar name={user.name} email={user.email} photo={user.photo} size={32} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{user.name || user.email}</div>
            <div className="text-muted-foreground truncate text-[11px]">{user.email}</div>
          </div>
        </div>
        <div className="text-muted-foreground px-2 pb-1.5 text-[11px]">{roleLabel}</div>

        <DropdownMenuSeparator />

        {/* Docs is docs.hired.tools. It is on another origin, hence the arrow
            and the tab; the skills it used to carry are on Settings, because
            those files are served by this instance and nothing else can. */}
        <DropdownMenuItem asChild>
          <Link href="/archive">
            <Trash2Icon /> Archive
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={MANUAL_URL} target="_blank" rel="noreferrer">
            <BookOpenIcon /> Docs
            <ArrowUpRightIcon className="text-muted-foreground ml-auto size-3.5" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon /> Settings
          </Link>
        </DropdownMenuItem>
        {canAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/settings/admin">
              <ShieldIcon /> Admin
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOutIcon /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
