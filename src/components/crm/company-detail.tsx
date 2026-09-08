"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, MailIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Stage, TagKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CorrespondenceCard, type CorrespondenceAccess } from "@/components/google/correspondence-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { MergeCompaniesDialog, type MergeCandidate } from "@/components/crm/merge-companies-dialog";
import { TagChip, type TagValue } from "@/components/tags/tag-chip";
import { TagPicker } from "@/components/tags/tag-picker";
import { SaveIndicator } from "@/components/save-indicator";
import type { SaveState } from "@/hooks/use-autosave";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import { linkHref } from "@/lib/social";
import { companyDomain } from "@/lib/company";
import {
  createContactAction,
  deleteCompanyAction,
  restoreRecordsAction,
  saveCompanyAction,
} from "@/server/actions";
import { relativeDay } from "@/lib/utils";

export type CompanyFields = {
  id: string;
  name: string;
  website: string;
  notes: string;
};

/**
 * The four lists a company wears. Industry, size and location were single text
 * boxes until they were tags: one company is plausibly fintech AND infra, and a
 * typo used to be a value of its own rather than something you fix once.
 */
export type CompanyTags = {
  industry: TagValue[];
  size: TagValue[];
  location: TagValue[];
  tags: TagValue[];
};

/** Which patch key each list writes back through. */
const TAG_PATCH_KEY = {
  industry: "industryIds",
  size: "sizeIds",
  location: "locationIds",
  tags: "tagIds",
} as const;

export function CompanyDetail({
  company,
  companyTags,
  applications,
  contacts,
  logos,
  candidates,
  suggestedMergeId,
  googleAccess,
}: {
  company: CompanyFields;
  companyTags: CompanyTags;
  applications: {
    id: string;
    roleTitle: string;
    stage: Stage;
    location: string;
    workMode: string;
    salaryRange: string;
    /** The posting itself, when there is one. Plenty of roles have none. */
    jobUrl: string;
    tags: TagValue[];
    appliedAt: string | null;
    nextFollowUpAt: string | null;
  }[];
  contacts: { id: string; name: string; title: string; email: string; relationship: string }[];
  logos: boolean;
  /** Whether their Gmail and Calendar are connected, for the threads-and-meetings card. */
  googleAccess: CorrespondenceAccess;
  /** Every other company on file, for folding a duplicate into this one. */
  candidates: MergeCandidate[];
  /** One of the candidates that looks like the same employer, if any. */
  suggestedMergeId?: string;
}) {
  const [values, setValues] = useState(company);
  const [tagSets, setTagSets] = useState(companyTags);
  const [state, setState] = useState<SaveState>("idle");
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState({ name: "", title: "", email: "", relationship: "" });
  const [saving, startSaving] = useTransition();
  const [, startTransition] = useTransition();
  const router = useRouter();

  const addPerson = () => {
    if (!person.name.trim()) return;
    startSaving(async () => {
      try {
        await createContactAction({ ...person, company: values.name });
        setPerson({ name: "", title: "", email: "", relationship: "" });
        setAdding(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save that contact.");
      }
    });
  };

  // Autosave on blur rather than on every keystroke: a company record is a
  // form you fill in, not a document you stream.
  const commit = (patch: Partial<CompanyFields>) => {
    const changed = Object.entries(patch).some(
      ([key, value]) => company[key as keyof CompanyFields] !== value,
    );
    if (!changed) return;
    setState("saving");
    startTransition(async () => {
      try {
        await saveCompanyAction(company.id, patch);
        setState("saved");
        router.refresh();
      } catch (error) {
        setState("idle");
        toast.error(error instanceof Error ? error.message : "Could not save that.");
        setValues(company);
      }
    });
  };

  const set = (patch: Partial<CompanyFields>) => setValues((prev) => ({ ...prev, ...patch }));

  // Tag lists save the moment they change rather than on blur: ticking a name
  // in a popover has no blur a person would recognise as "done".
  const saveFacet = (field: keyof CompanyTags, next: TagValue[]) => {
    const previous = tagSets[field];
    setTagSets((prev) => ({ ...prev, [field]: next }));
    setState("saving");
    startTransition(async () => {
      try {
        await saveCompanyAction(company.id, {
          [TAG_PATCH_KEY[field]]: next.map((tag) => tag.id),
        });
        setState("saved");
        router.refresh();
      } catch (error) {
        setState("idle");
        toast.error(error instanceof Error ? error.message : "Could not save that.");
        setTagSets((prev) => ({ ...prev, [field]: previous }));
      }
    });
  };
  const domain = logos ? companyDomain({ name: values.name, website: values.website }) : null;

  const remove = () => {
    // It no longer refuses while applications point here, and the copy no
    // longer threatens: the company and its applications go to the archive
    // together and come back together. What this has to say is what goes with
    // it and what does not.
    const takes =
      applications.length > 0
        ? ` ${applications.length === 1 ? "Its application goes" : `All ${applications.length} applications go`} with it, timelines and tasks included.`
        : "";
    const stays =
      contacts.length > 0
        ? ` The ${contacts.length === 1 ? "person" : `${contacts.length} people`} on file here stay, and lose this one company.`
        : "";
    if (!confirm(`Delete ${company.name}?${takes}${stays} You can restore it from the archive.`)) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await deleteCompanyAction(company.id);
        toast.success(
          `${company.name} moved to the archive${result.withIt ? `, ${result.withIt}` : ""}`,
          {
            action: {
              label: "Undo",
              onClick: () => {
                void restoreRecordsAction("company", [company.id]).then(() => router.refresh());
              },
            },
          },
        );
        router.push("/crm/companies");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete that company.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyAvatar name={values.name} domain={domain} size={44} />
        <div className="min-w-0 flex-1">
          <Input
            value={values.name}
            onChange={(event) => set({ name: event.target.value })}
            onBlur={() => commit({ name: values.name })}
            className="h-auto border-0 bg-transparent px-0 text-[22px] font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <div className="text-faint text-[12.5px]">
            {[...tagSets.industry, ...tagSets.location].map((tag) => tag.name).join(" · ") ||
              "No industry set"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator state={state} />
          <MergeCompaniesDialog
            company={{ id: company.id, name: values.name }}
            candidates={candidates}
            logos={logos}
            suggestedId={suggestedMergeId}
          />
          {values.website && (
            <Button asChild variant="outline" size="sm">
              <a
                href={values.website.startsWith("http") ? values.website : `https://${values.website}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLinkIcon /> Visit
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete company"
            className="text-muted-foreground hover:text-destructive"
            onClick={remove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">What you know</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={values.notes}
                onChange={(event) => set({ notes: event.target.value })}
                onBlur={() => commit({ notes: values.notes })}
                placeholder="Who they are, how they make money, who you know there, what the interview loop looks like, why you do or don't want this. Everything here is yours alone."
                className="min-h-48 resize-y"
              />
            </CardContent>
          </Card>

          {/* Every role you have chased here, as listings rather than table
              rows: what it is, where it got to, and a way through to the
              posting itself — which was previously unreachable from the one
              screen about this employer. */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-[15px]">
                Job listings{" "}
                {applications.length > 0 && (
                  <span className="text-faint nums font-normal">{applications.length}</span>
                )}
              </CardTitle>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/applications?new=1&company=${encodeURIComponent(values.name)}`}>
                  <PlusIcon /> Track a role
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {applications.length === 0 ? (
                <p className="text-faint py-4 text-center text-[13px]">
                  No roles tracked here yet. Track one and it shows up as a listing, with or
                  without a link to the posting.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {applications.map((application) => (
                    <JobListing key={application.id} application={application} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Everything from this company's domain, and everyone on file here.
              The website field is what makes the domain match, which is one
              more reason to set it. */}
          <CorrespondenceCard subject={{ kind: "company", id: company.id }} access={googleAccess} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field
                label="Website"
                hint="Their own site. This is what the logo comes from — not the job board the posting is on."
                value={values.website}
                placeholder="stripe.com"
                onChange={(website) => set({ website })}
                onCommit={() => commit({ website: values.website })}
              />
              <TagField
                label="Industry"
                kind="INDUSTRY"
                value={tagSets.industry}
                placeholder="Fintech, infrastructure…"
                onChange={(next) => saveFacet("industry", next)}
              />
              <TagField
                label="Size"
                kind="SIZE"
                value={tagSets.size}
                placeholder="200–500, Series C"
                onChange={(next) => saveFacet("size", next)}
              />
              <TagField
                label="Location"
                kind="LOCATION"
                value={tagSets.location}
                placeholder="San Francisco, remote…"
                onChange={(next) => saveFacet("location", next)}
              />
              <TagField
                label="Tags"
                kind="COMPANY"
                value={tagSets.tags}
                placeholder="Dream list, referral…"
                onChange={(next) => saveFacet("tags", next)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-[15px]">
                People {contacts.length > 0 && <span className="text-faint nums font-normal">{contacts.length}</span>}
              </CardTitle>
              <Button variant="ghost" size="xs" onClick={() => setAdding((value) => !value)}>
                <UserPlusIcon /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {adding && (
                <div className="space-y-2">
                  <Input
                    value={person.name}
                    onChange={(event) => setPerson({ ...person, name: event.target.value })}
                    placeholder="Name"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={person.title}
                      onChange={(event) => setPerson({ ...person, title: event.target.value })}
                      placeholder="Title"
                    />
                    <Input
                      value={person.relationship}
                      onChange={(event) =>
                        setPerson({ ...person, relationship: event.target.value })
                      }
                      placeholder="Recruiter"
                    />
                  </div>
                  <Input
                    value={person.email}
                    onChange={(event) => setPerson({ ...person, email: event.target.value })}
                    onKeyDown={(event) => event.key === "Enter" && addPerson()}
                    placeholder="Email"
                  />
                  <Button size="sm" onClick={addPerson} disabled={saving || !person.name.trim()}>
                    Save contact
                  </Button>
                </div>
              )}
              {contacts.length === 0 ? (
                <p className="text-faint py-4 text-center text-[13px]">Nobody on file here yet.</p>
              ) : (
                <ul className="space-y-1">
                  {contacts.map((contact) => (
                    <li key={contact.id}>
                      <Link
                        href={`/crm/contacts/${contact.id}`}
                        className="hover:bg-accent/50 -mx-2 flex items-center gap-2 rounded-control px-2 py-1.5 transition-colors duration-150"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{contact.name}</div>
                          <div className="text-faint truncate text-[12px]">
                            {contact.title || contact.relationship || "No title"}
                          </div>
                        </div>
                        {contact.email && <MailIcon className="text-faint size-3.5 shrink-0" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One role at this employer.
 *
 * The stretched-link rule from the contacts table applies here too: the card
 * is one link to the tracked application, and the posting's own URL is a
 * second, separate destination that has to paint above it rather than nest
 * inside it.
 */
function JobListing({
  application,
}: {
  application: {
    id: string;
    roleTitle: string;
    stage: Stage;
    location: string;
    workMode: string;
    salaryRange: string;
    jobUrl: string;
    tags: TagValue[];
    appliedAt: string | null;
    nextFollowUpAt: string | null;
  };
}) {
  const posting = linkHref(application.jobUrl);
  const where = [application.location, application.workMode].filter(Boolean).join(" · ");

  return (
    <li className="hover:bg-accent/40 relative rounded-control border p-2.5 transition-colors duration-150">
      <div className="flex items-start gap-2">
        <Link
          href={`/applications/${application.id}`}
          className="min-w-0 flex-1 text-[13px] font-medium before:absolute before:inset-0"
        >
          {application.roleTitle}
        </Link>
        <span
          className="stage-chip shrink-0 rounded-chip px-1.5 py-0.5 text-[11.5px] font-medium"
          style={{ ["--tone" as string]: STAGE_TONE[application.stage] }}
        >
          {STAGE_LABEL[application.stage]}
        </span>
      </div>

      <div className="text-faint mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
        {where && <span className="truncate">{where}</span>}
        {application.salaryRange && <span className="truncate">{application.salaryRange}</span>}
        {application.nextFollowUpAt && (
          <span className="nums">
            Chase {relativeDay(new Date(application.nextFollowUpAt))}
          </span>
        )}
        {!where && !application.salaryRange && !application.nextFollowUpAt && (
          <span>No details yet</span>
        )}
        {posting && (
          <a
            href={posting}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground relative ml-auto inline-flex items-center gap-1 transition-colors"
            aria-label={`Open the ${application.roleTitle} posting`}
          >
            <ExternalLinkIcon className="size-3" /> Posting
          </a>
        )}
      </div>

      {application.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {application.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </div>
      )}
    </li>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  // Tie the label to the input: it makes the label clickable, and it is the
  // only thing that tells a screen reader which box "Website" belongs to.
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
      />
      {hint && <p className="text-faint text-xs leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * A tag list wearing the same label-and-box furniture as the text fields
 * beside it, so the Details card still reads as one form.
 */
function TagField({
  label,
  kind,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  kind: TagKind;
  value: TagValue[];
  placeholder: string;
  onChange: (next: TagValue[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <TagPicker kind={kind} value={value} placeholder={placeholder} onChange={onChange} />
    </div>
  );
}
