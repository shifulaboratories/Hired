"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SaveIndicator } from "@/components/save-indicator";
import { BackgroundEditor } from "@/components/me/background-editor";
import { useAutosave } from "@/hooks/use-autosave";
import { saveProfileAction } from "@/server/actions";

type ProfileValues = {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
  summary: string;
  background: string;
};

export function ProfileForm({ profile }: { profile: ProfileValues }) {
  const [values, setValues] = useState<ProfileValues>({
    fullName: profile.fullName,
    headline: profile.headline,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    website: profile.website,
    linkedin: profile.linkedin,
    github: profile.github,
    summary: profile.summary,
    background: profile.background,
  });

  const { state, push } = useAutosave<ProfileValues>((next) => saveProfileAction(next));

  const set = (key: keyof ProfileValues) => (value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    push(next);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-[15px]">Identity</CardTitle>
          <SaveIndicator state={state} />
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Full name" value={values.fullName} onChange={set("fullName")} placeholder="Ada Lovelace" />
          <Field
            label="Headline"
            value={values.headline}
            onChange={set("headline")}
            placeholder="Staff Software Engineer"
          />
          <Field label="Email" value={values.email} onChange={set("email")} placeholder="you@example.com" />
          <Field label="Phone" value={values.phone} onChange={set("phone")} placeholder="+1 555 000 1234" />
          <Field
            label="Location"
            value={values.location}
            onChange={set("location")}
            placeholder="Austin, TX"
          />
          <Field label="Website" value={values.website} onChange={set("website")} placeholder="yoursite.com" />
          <Field
            label="LinkedIn"
            value={values.linkedin}
            onChange={set("linkedin")}
            placeholder="linkedin.com/in/you"
          />
          <Field label="GitHub" value={values.github} onChange={set("github")} placeholder="github.com/you" />
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Career summary</CardTitle>
            <p className="text-muted-foreground text-sm">
              The default summary paragraph on your resumes. Claude will rewrite it per job.
            </p>
          </CardHeader>
          <CardContent>
            <Textarea
              value={values.summary}
              onChange={(event) => set("summary")(event.target.value)}
              placeholder="Platform engineer with eight years building payments infrastructure…"
              className="min-h-28"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Personal background</CardTitle>
            <p className="text-muted-foreground text-sm">
              Not for the resume — this is context for Claude. What you want next, what you refuse to
              do again, comp expectations, how you work, what you are proud of, what you are bad at.
              A <code className="bg-inset rounded px-1 font-mono text-[12px]">RULE:</code> here binds
              every document, and an <code className="bg-inset rounded px-1 font-mono text-[12px]">OPEN:</code>{" "}
              joins your list of things to settle.
            </p>
          </CardHeader>
          <CardContent>
            {/* The same reader the roles use, so it reads as text rather than
                as source, and a marking here looks like a marking there. */}
            <BackgroundEditor
              mode="profile"
              value={values.background}
              onChange={set("background")}
              placeholder={`I want to move from IC to staff-level scope without going into management…
Comp: targeting $220k+ base, will trade for equity at a Series B.
Non-negotiable: no on-call rotation under four engineers.
RULE: never put a salary figure in writing.`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
