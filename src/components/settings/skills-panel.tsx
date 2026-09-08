import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyBlock } from "@/components/settings/copy-block";
import type { Skill } from "@/lib/skills";

/**
 * The skills, on the screen where you wire up an assistant.
 *
 * They used to live on /docs, which is gone: everything else that page carried
 * is written out at docs.hired.tools and generated from the same tools array,
 * so two renderings of it was one rendering that could go stale. These files
 * could not move with the rest, because they are served by *this* instance —
 * byte-for-byte the copy in the repository it is running — and a static site
 * cannot hand you a zip built from a folder on someone else's server.
 *
 * Connections is the right home for what is left. Installing a skill is part of
 * setting an assistant up, not part of reading about one.
 *
 * Folded away, though. This is the one block on the page that talks about file
 * paths and zip uploads, and open by default it was three times the height of
 * the connection row a new person actually came here to click — which made
 * "connect an assistant" look like a job for somebody who knows what
 * `~/.claude/skills/` means. A `<details>` rather than state: this is a server
 * component, the browser already knows how to do this, and the whole panel
 * stays in the page for anyone searching it with ⌘F.
 */
export function SkillsPanel({ skills }: { skills: Skill[] }) {
  if (skills.length === 0) return null;

  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-5 [&::-webkit-details-marker]:hidden">
          <SparklesIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight">Skills</span>
            <span className="text-muted-foreground block text-[13px]">
              Optional. {skills.length} file{skills.length === 1 ? "" : "s"} that teach Claude how
              to behave before you ask it anything — worth it once you are connected.
            </span>
          </span>
          <ChevronDownIcon className="text-faint size-4 shrink-0 transition-transform duration-200 group-open:rotate-180" />
        </summary>
      <CardContent className="space-y-4 pt-1 text-[13.5px] leading-relaxed">
        <p className="text-muted-foreground">
          A skill is a file that teaches Claude how to behave before you ask it anything. The ones
          below ship with your instance. The first is the one to install if you install only one —
          it carries the rules that keep a resume honest.
        </p>

        <div className="bg-inset shadow-hairline rounded-control px-3.5 py-3">
          <div className="mb-1.5 text-[13px] font-medium">Where they go</div>
          <ul className="text-muted-foreground space-y-1 text-[13px]">
            <li>
              <span className="text-foreground font-medium">Claude Code</span> —{" "}
              <code className="bg-card rounded px-1 py-0.5 font-mono text-[12px]">
                ~/.claude/skills/&lt;name&gt;/SKILL.md
              </code>{" "}
              for every project, or{" "}
              <code className="bg-card rounded px-1 py-0.5 font-mono text-[12px]">
                .claude/skills/
              </code>{" "}
              inside one.
            </li>
            <li>
              <span className="text-foreground font-medium">Claude apps</span> — Settings →
              Capabilities → Skills → upload the zip. The upload wants a folder, not a loose file,
              which is what the zip below already is.
            </li>
            <li>
              <span className="text-foreground font-medium">Anything else</span> — paste the
              contents in at the start of a conversation. Less tidy, same effect.
            </li>
          </ul>
        </div>

        <div className="space-y-4">
          {skills.map((skill) => (
            <div key={skill.slug} className="space-y-2">
              <div>
                <div className="font-mono text-[13px] font-medium">{skill.name}</div>
                <p className="text-muted-foreground mt-0.5 text-[13px]">{skill.description}</p>
              </div>
              <CopyBlock
                body={skill.body}
                downloads={[
                  { href: `/docs/skills/${skill.slug}`, name: "SKILL.md", label: "SKILL.md" },
                  { href: `/docs/skills/${skill.slug}.zip`, name: `${skill.slug}.zip`, label: "Zip" },
                ]}
              />
            </div>
          ))}
        </div>
      </CardContent>
      </details>
    </Card>
  );
}
