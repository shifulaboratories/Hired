/**
 * What an assistant should reach for, and what it reaches for instead.
 *
 * This file is the closest thing this project has to a test suite, and it tests
 * the one thing that actually breaks in the field. There is no CI and no unit
 * tests here — typecheck and build are the whole gate — because almost nothing
 * in this codebase is a pure function worth asserting on. The exception is tool
 * routing: the product thesis is that the description IS the UX, and a
 * description that misroutes writes garbage into somebody's career history.
 * That is measurable, so it is measured.
 *
 * Each case is a thing a person would plausibly say, and the tools that would
 * be a correct FIRST call. `expect` is a list rather than one name because more
 * than one answer is often right — "what have I done with Kubernetes" is
 * legitimately search_me, and legitimately get_me_snapshot if the assistant
 * wants everything. It is a list of acceptable answers, not a list of
 * required ones: calling any one of them passes.
 *
 * `avoid` is the sharper half. It names the tool a naive reading picks, and it
 * is where the regressions show up: `update_role` eating a background,
 * `create_application` where `capture_job_posting` was meant, `delete_*` where
 * the thing is archived rather than destroyed. A case with an `avoid` that the
 * model picks is a FAILURE even if the description reads well to a human.
 *
 * Rules for adding to this file:
 *
 * - A case must come from a real misroute, or from a trap you can name. Cases
 *   invented to pad the count make the score go up and tell you nothing.
 * - Write the prompt the way a person talks, not the way the schema reads. If
 *   the prompt contains the tool's own name it is testing nothing.
 * - When you change a tool description because of a failure here, add the case
 *   first and watch it fail. A fix that was never observed failing is a guess.
 *
 * Run it with `node tools/eval-tool-choice.mjs`. It costs real money and says
 * so before it spends any.
 */

/**
 * The stage of a conversation a case is testing.
 *
 * `cold` means the assistant has just connected and has no context — the
 * hardest and most common case. `warm` supplies a line or two of prior turn,
 * for traps that only appear once something has already been read.
 */
export const CASES = [
  // -------------------------------------------------------------------------
  // ME — the retrieval trap, and the one that eats people's notes
  // -------------------------------------------------------------------------
  {
    prompt: "What have I done with Kubernetes?",
    expect: ["search_me"],
    why: "The routing sentence in search_me's description exists for exactly this.",
  },
  {
    prompt: "I'm applying for a staff infra role. Pull together what I've got that's relevant.",
    expect: ["search_me", "get_me_snapshot"],
    avoid: ["list_roles"],
    why: "Searching the language of the posting beats listing roles and reading them all.",
  },
  {
    prompt: "Tell me everything you know about my career so far.",
    expect: ["get_me_snapshot", "search_me"],
    why: "The one case where the big read is right.",
  },
  {
    prompt: "At Acme I also ran the on-call rotation for about eighteen months. File that.",
    expect: ["append_role_background"],
    avoid: ["update_role", "create_role", "create_note"],
    why: "THE regression. update_role replaces, so it silently drops the rest of the background.",
  },
  {
    prompt: "Actually my title at Acme was Staff Engineer, not Senior. Fix it.",
    expect: ["update_role", "list_roles", "get_role"],
    why: "A genuine field correction, which is what update_role is for.",
  },
  {
    prompt: "Add a bullet: cut p99 latency by 40% on the checkout path.",
    expect: ["create_highlights", "append_role_background"],
    avoid: ["update_role"],
    why: "A polished reusable bullet is a highlight, not a rewrite of the role.",
  },
  {
    prompt: "Never let a resume of mine say I'm a 'rockstar'.",
    expect: ["create_note"],
    avoid: ["update_profile"],
    why: "A standing rule is a GUARDRAIL note, and the note tools carry the kind.",
  },
  {
    prompt: "Here's my old resume, pasted below. Get it into the system.",
    expect: ["import_resume", "preview_resume_import"],
    avoid: ["create_resume", "create_role"],
    why: "import_resume is additive and safe to repeat; create_resume builds a document instead.",
  },

  // -------------------------------------------------------------------------
  // RESUMES — copy before you edit, and the two ways to hand somebody a document
  // -------------------------------------------------------------------------
  {
    prompt: "Write me a resume for this backend role at Stripe.",
    expect: ["get_resume_format", "search_me", "tailor_resume"],
    avoid: ["create_resume"],
    why: "get_resume_format first or the document will not validate; evidence before prose.",
  },
  {
    prompt: "Tailor my main resume to this job description.",
    expect: ["tailor_resume", "duplicate_resume", "search_me", "list_resumes"],
    avoid: ["update_resume"],
    why: "Editing a resume already attached to an application rewrites history. Copy first.",
  },
  {
    prompt: "Is this thing over a page?",
    expect: ["preview_resume_text", "check_resume_fit"],
    avoid: ["export_resume_pdf"],
    why: "The dry run answers it without saving or rendering.",
  },
  {
    prompt: "The application form wants a link to my resume.",
    expect: ["publish_resume"],
    avoid: ["export_resume_pdf"],
    why: "A URL is publish; a PDF is a file. The form asked for a URL.",
  },
  {
    prompt: "Send me a PDF of it.",
    expect: ["export_resume_pdf"],
    avoid: ["publish_resume", "preview_resume_text"],
    why: "The mirror of the case above.",
  },
  {
    prompt: "Take that link down.",
    expect: ["unpublish_resume"],
    why: "Revoking the unlisted URL, not deleting the resume.",
  },
  {
    prompt: "What's different between the Stripe version and the one I started from?",
    expect: ["compare_resumes"],
    avoid: ["get_resume"],
    why: "The diff exists; reading both and eyeballing them is the failure.",
  },
  {
    prompt: "Which of these bullets can I actually back up?",
    expect: ["trace_resume_evidence"],
    avoid: ["compare_resumes", "search_me"],
    why: "Evidence tracing is its own tool and answers the fabrication question directly.",
  },
  {
    prompt: "Move the education section above experience.",
    expect: ["reorder_resume"],
    avoid: ["update_resume"],
    why: "update_resume replaces the whole document to achieve a move.",
  },

  // -------------------------------------------------------------------------
  // LETTERS — the tool that has to be called first
  // -------------------------------------------------------------------------
  {
    prompt: "Draft a cover letter for the Datadog application.",
    expect: ["prep_letter"],
    avoid: ["create_letter", "write_letter", "search_me"],
    why: "prep_letter FIRST, always — it returns the posting, the research, the evidence and prior letters.",
  },
  {
    prompt: "I need to ask Priya for a referral at Figma.",
    expect: ["prep_letter", "list_contacts"],
    avoid: ["create_letter"],
    why: "A referral ask is a letter kind, and it still starts with prep.",
  },
  {
    prompt: "What have I written to people at Stripe before?",
    expect: ["list_letters", "list_correspondence"],
    why: "Prior letters are stored; this is a read, not a draft.",
  },

  // -------------------------------------------------------------------------
  // PIPELINE — capture, quiet, and the difference between a stage and a field
  // -------------------------------------------------------------------------
  {
    prompt: "https://boards.greenhouse.io/acme/jobs/4123456 — add this one.",
    expect: ["capture_job_posting"],
    avoid: ["create_application"],
    why: "One move: fetch the posting, make the company, make the application.",
  },
  {
    prompt: "I've got eight tabs open from this morning, here are the links.",
    expect: ["capture_job_postings"],
    avoid: ["capture_job_posting"],
    why: "The plural tool exists for a morning of tabs; eight sequential calls is the failure.",
  },
  {
    prompt: "What's gone quiet?",
    expect: ["list_applications", "pipeline_review"],
    avoid: ["list_follow_ups"],
    why: "quietForDays is the quiet metric. list_follow_ups answers a different question.",
  },
  {
    prompt: "What do I owe people this week?",
    expect: ["list_follow_ups", "list_schedule", "list_tasks"],
    why: "Overdue follow-ups, or the week as a window.",
  },
  {
    prompt: "What does next week look like?",
    expect: ["list_schedule"],
    avoid: ["list_tasks", "list_applications"],
    why: "A window of time is list_schedule; it merges follow-ups, tasks, activity and meetings.",
  },
  {
    prompt: "I got the phone screen at Linear. Move it along.",
    expect: ["move_application_stage"],
    avoid: ["update_application"],
    why: "A stage move writes the timeline row the funnel reads. Setting the column does not.",
  },
  {
    prompt: "These four are dead, mark them lost.",
    expect: ["move_applications_stage"],
    avoid: ["move_application_stage"],
    why: "The bulk tool exists; four calls is the failure.",
  },
  {
    prompt: "The Acme posting says 190 to 230.",
    expect: ["update_application"],
    avoid: ["record_offer"],
    why: "What the POSTING advertised is a field. An offer is a row, and nothing parses one into the other.",
  },
  {
    prompt: "Acme came back with 215 base, 40k of equity a year and a 20k signing bonus.",
    expect: ["record_offer"],
    avoid: ["update_application"],
    why: "The mirror. This is an offer, and it belongs in its own row so revisions are visible.",
  },
  {
    prompt: "They came back up to 235. Log the new number.",
    expect: ["record_offer"],
    avoid: ["update_offer"],
    why: "A revision is a new row — the movement IS the negotiation record.",
  },
  {
    prompt: "Which of these two offers is actually better?",
    expect: ["compare_offers", "offer_briefing"],
    why: "The comparison tool, which refuses to convert currencies rather than guessing.",
  },
  {
    prompt: "Had a good call with the recruiter, she's sending it to the hiring manager.",
    expect: ["log_activity"],
    avoid: ["create_note", "update_application"],
    why: "Something that happened on a date is a timeline row.",
  },
  {
    prompt: "Push the Figma follow-up out a week, I'm on holiday.",
    expect: ["snooze_follow_up"],
    avoid: ["update_application", "log_follow_up"],
    why: "Snooze moves the date. log_follow_up records that you did it.",
  },
  {
    prompt: "Chased Acme today, no reply yet.",
    expect: ["log_follow_up"],
    avoid: ["snooze_follow_up"],
    why: "The mirror of the case above.",
  },
  {
    prompt: "How am I actually doing?",
    expect: ["pipeline_stats", "get_funnel", "pipeline_review"],
    why: "The stats read, not a list of everything.",
  },
  {
    prompt: "Where in my search is the bottleneck?",
    expect: ["diagnose_search", "get_funnel"],
    avoid: ["pipeline_stats"],
    why: "Diagnosis is its own tool and includes per-source conversion.",
  },
  {
    prompt: "Show my board to my friend Sam so he can tell me what to chase.",
    expect: ["share_pipeline"],
    avoid: ["export_csv"],
    why: "A read-only link, not a file.",
  },
  {
    prompt: "Give me a spreadsheet of everything I've applied to.",
    expect: ["export_csv"],
    avoid: ["share_pipeline", "export_everything"],
    why: "The mirror. A CSV of one kind, not the whole workspace as JSON.",
  },
  {
    prompt: "I want a backup of the whole thing in case this box dies.",
    expect: ["export_everything"],
    avoid: ["export_csv"],
    why: "One reimportable file is the backup; three CSVs are not.",
  },

  // -------------------------------------------------------------------------
  // DELETING — everything here is a trap, because three models archive
  // -------------------------------------------------------------------------
  {
    prompt: "Delete the Acme application, I'm not going for it.",
    expect: ["archive_records", "delete_application"],
    avoid: ["empty_archive", "delete_archived"],
    why: "Deleting an application archives it. Destroying the archive is a different, permanent act.",
  },
  {
    prompt: "Get rid of that resume, it was a bad draft.",
    expect: ["delete_resume"],
    avoid: ["archive_records"],
    why: "A resume really is gone when deleted — only three models archive.",
  },
  {
    prompt: "Empty the bin.",
    expect: ["empty_archive"],
    avoid: ["archive_records", "delete_archived"],
    why: "The whole archive, permanently. This one must be confirmed in words first.",
  },
  {
    prompt: "I archived Stripe by mistake, put it back.",
    expect: ["restore_records", "list_archive"],
    why: "Restore, which is why archiving exists at all.",
  },

  // -------------------------------------------------------------------------
  // CRM — labels are records, and a company is not a contact
  // -------------------------------------------------------------------------
  {
    prompt: "Tag the Acme application as coming from a referral.",
    expect: ["list_tags", "update_application"],
    avoid: ["create_tag"],
    why: "Read the catalogue first — passing a name that exists matches it rather than minting a twin.",
  },
  {
    prompt: "I've got Acme in here twice, as 'Acme' and 'Acme Inc'.",
    expect: ["preview_company_merge", "merge_companies"],
    avoid: ["delete_company", "update_company"],
    why: "Merging is permanent, so the preview exists. Deleting one loses its applications.",
  },
  {
    prompt: "Priya from Figma introduced me to their VP of Eng.",
    expect: ["create_contact", "list_contacts", "get_contact"],
    avoid: ["create_company"],
    why: "A person, not an employer.",
  },
  {
    prompt: "Who haven't I spoken to in a while?",
    expect: ["list_relationships", "list_contacts", "schedule_contact_pings"],
    why: "The relationship view, which is what this is for.",
  },

  // -------------------------------------------------------------------------
  // THE REVIEW QUEUE, MAIL, AND THE ADMIN SPLIT
  // -------------------------------------------------------------------------
  {
    prompt: "Anything waiting for me to approve?",
    expect: ["list_proposals"],
    avoid: ["list_tasks"],
    why: "The review queue is its own thing and holds writes that have not happened yet.",
  },
  {
    prompt: "Go through my inbox and tell me what the pipeline is missing.",
    expect: ["inbox_review", "search_email"],
    why: "The workflow that reads a week of mail and queues what it finds.",
  },
  {
    prompt: "What did Acme's recruiter actually say in that thread?",
    expect: ["search_email", "get_email_thread", "list_correspondence"],
    avoid: ["list_activities"],
    why: "Mail is read live from the person's own account, never copied into the app.",
  },
  {
    prompt: "Mail me a summary every Monday morning.",
    expect: ["set_digest_settings"],
    avoid: ["send_digest_now", "preview_digest"],
    why: "Turning the schedule on, not sending one now.",
  },
  {
    prompt: "Actually show me what that email would say first.",
    expect: ["preview_digest"],
    avoid: ["send_digest_now"],
    why: "The dry run. Sending it to find out is the failure.",
  },
  {
    prompt: "How many people are on this instance?",
    expect: ["admin_instance_stats", "admin_list_users"],
    adminOnly: true,
    why: "An admin read. A member must not see this tool at all.",
  },
  {
    prompt: "Who am I connected as?",
    expect: ["whoami"],
    avoid: ["get_profile", "admin_list_users"],
    why: "The connection's own identity, not the profile and not the user table.",
  },
  {
    prompt: "One of my connection URLs may have leaked.",
    expect: ["rotate_connection"],
    avoid: ["delete_connection"],
    why: "Rotating keeps the client working; deleting kills it.",
  },

  // --- interviews: a round is a thing, not a free-text activity -------------
  {
    prompt: "I've got a system design round with Stripe on Tuesday at 2.",
    expect: ["schedule_interview"],
    avoid: ["log_activity", "create_task", "update_application"],
    why: "A round is a record with a format and an outcome. Logged as an activity it has neither, which is the shape interviews had before they were first-class.",
  },
  {
    prompt: "Did the onsite at Figma yesterday. Went well, they said two weeks.",
    expect: ["record_interview_outcome", "schedule_interview"],
    avoid: ["log_activity", "move_application_stage"],
    why: "An interview that already happened has an outcome to record. Moving the stage on 'went well' is acting on a feeling.",
  },
  {
    prompt: "They asked me how I'd design a rate limiter and what I'd do about a teammate who missed deadlines.",
    expect: ["log_interview_questions"],
    avoid: ["create_note", "append_role_background"],
    why: "Questions are rows against a round, which is what makes question_bank work later. In a note they are prose nothing can read.",
  },
  {
    prompt: "What kinds of things do people keep asking me in interviews?",
    expect: ["question_bank"],
    avoid: ["list_interviews", "search_me"],
    why: "The bank is the aggregate across rounds. list_interviews returns the rounds and leaves the reading to you.",
  },
  {
    prompt: "I'm interviewing at Vercel on Thursday, get me ready.",
    expect: ["prep_interview", "prep_for_interview"],
    avoid: ["get_application", "search_me"],
    why: "Seven things decide an interview and they live seven places apart. The tool reads all of them; get_application reads one.",
  },
  {
    prompt: "Dana said she'd put my name in at Figma.",
    expect: ["record_referral"],
    avoid: ["create_contact", "log_activity", "create_task"],
    why: "A referral has a status that moves. Logged as an activity it cannot be chased.",
  },

  // --- the analyses: each answers a question the raw lists do not -----------
  {
    prompt: "Why do I keep getting to the final round and then losing?",
    expect: ["loss_report"],
    avoid: ["get_funnel", "pipeline_stats", "list_applications"],
    why: "The funnel shows where they fall out; the loss report is the one that groups by REASON, which is what the question asks.",
  },
  {
    prompt: "Which of my resumes actually gets replies?",
    expect: ["resume_performance"],
    avoid: ["list_resumes", "compare_resumes", "pipeline_stats"],
    why: "list_resumes returns documents. The question is about what happened to the applications they were attached to.",
  },
  {
    prompt: "What should I be learning? The same things keep coming up in jobs I don't get.",
    expect: ["skills_gap"],
    avoid: ["check_resume_fit", "gap_report", "search_me"],
    why: "A learning list across every captured posting. check_resume_fit and gap_report answer 'does this resume fit THIS job', which is the other question.",
  },
  {
    prompt: "Who should I get back in touch with?",
    expect: ["contact_warmth"],
    avoid: ["list_contacts", "list_relationships", "list_follow_ups"],
    why: "list_relationships ranks by worth and leaves time out of it. Warmth is the one that discounts by silence, which is what 'get back in touch' means.",
  },
  {
    prompt: "Morning. Where am I?",
    expect: ["morning_brief"],
    avoid: ["list_applications", "pipeline_stats", "list_schedule"],
    why: "The one call to open a session with. Assembling it from four reads is the thing it exists to stop.",
  },
  {
    prompt: "Is there anything half-finished or messy in here?",
    expect: ["workspace_health"],
    avoid: ["diagnose_search", "pipeline_stats"],
    why: "diagnose_search is about whether search finds things; health is about the labels every other feature leans on.",
  },
  {
    prompt: "Which companies have I not looked at in ages?",
    expect: ["research_freshness"],
    avoid: ["list_companies", "research_company"],
    why: "Freshness is about the age of what is on file. Calling research_company here would go and research one before knowing which.",
  },

  // --- watching, cadence, undo ---------------------------------------------
  {
    prompt: "Let me know when Stripe posts another backend role.",
    expect: ["watch_company_board"],
    avoid: ["create_task", "snooze_follow_up", "research_company"],
    why: "A task to check a careers page every week is the manual version of the thing being asked for.",
  },
  {
    prompt: "Is the Ramp job still up?",
    expect: ["check_posting_live"],
    avoid: ["get_application", "capture_job_posting", "research_company"],
    why: "The posting URL is already on file; this fetches it and says whether it is still there.",
  },
  {
    prompt: "Chase anything that's been sitting in Applied for more than ten days.",
    expect: ["set_stage_cadence"],
    avoid: ["create_task", "create_stage_template", "list_applications"],
    why: "A cadence is a standing rule. A task covers one application once, and a stage template fires on arrival rather than on age.",
  },
  {
    prompt: "You just overwrote my whole background for that job. Put it back.",
    expect: ["list_changes", "undo_change", "list_revisions", "restore_revision"],
    avoid: ["update_role", "append_role_background"],
    why: "The one case where writing again is the wrong instinct. Find the change, then undo it — writing back from memory invents what was lost.",
  },

  // --- capture: the file, the archive, the link ----------------------------
  {
    prompt: "I downloaded my data export from LinkedIn, it's a zip.",
    expect: ["import_linkedin_archive"],
    avoid: ["import_resume", "preview_resume_import"],
    why: "An archive is connections and positions, not a resume. import_resume would throw away the contacts.",
  },
  {
    prompt: "They emailed me the full job description as a PDF, keep it with the application.",
    expect: ["attach_file"],
    avoid: ["create_note", "capture_job_posting", "update_application"],
    why: "A file is a file. Pasting it into the notes loses the original, which is the thing they asked to keep.",
  },
  {
    prompt: "Will this resume survive an applicant tracking system?",
    expect: ["preview_ats_text"],
    avoid: ["preview_resume_text", "check_resume_fit", "export_resume_pdf"],
    why: "preview_resume_text estimates length. The ATS question is about what a parser can read out of it.",
  },
  {
    prompt: "Fill this thing with fake data so I can see what it looks like before I commit.",
    expect: ["load_sample_workspace"],
    avoid: ["create_application", "create_company", "import_everything"],
    why: "The sample is marked and removable. Hand-made fake rows are indistinguishable from real ones a week later.",
  },

  // --- sending: the gate is the point --------------------------------------
  {
    prompt: "Write to the recruiter at Linear and send it.",
    expect: ["draft_outbound_email", "prep_letter"],
    avoid: ["send_outbound_email"],
    why: "Nothing leaves this building without a person approving that exact text. send_outbound_email sends what is already approved, and reaching for it first is the failure this whole feature is shaped around.",
  },

  // --- background sections: a constraint is not a fact ----------------------
  {
    prompt: "Don't ever put the names of our internal tools on paper — describe them by what they do.",
    expect: ["append_role_background"],
    avoid: ["update_role", "create_note", "update_profile"],
    why: "A binding rule about how a job may be described belongs in that role's background under the reserved 'Rules' heading. update_role would replace the background to store it, which is the misroute that eats people's notes.",
  },
  {
    prompt: "I've only been at this job four months and every recruiter asks about it. Remember that.",
    expect: ["append_role_background"],
    avoid: ["create_note", "update_role", "log_win"],
    why: "Positioning, not evidence. It goes under 'Caveats' so it reaches interview prep and never a resume — filed as a plain note it is loose from the role it is about.",
  },
  {
    prompt: "What am I not allowed to say about the agency job?",
    expect: ["get_role", "search_me"],
    avoid: ["get_me_snapshot", "list_roles"],
    why: "get_role returns that role's rules and caveats already separated. list_roles returns titles and dates and answers nothing.",
  },

  // --- after the search ----------------------------------------------------
  {
    prompt: "I shipped the billing migration this quarter and it cut our costs by about a third.",
    expect: ["log_win", "append_role_background"],
    avoid: ["update_role", "create_note", "create_highlights"],
    why: "Additive, against the current role. update_role replaces the background, which is the misroute this whole file exists for.",
  },
];

/**
 * Cases that must NOT reach a tool at all.
 *
 * A connected assistant that answers "what's the capital of France" with a
 * search_me call is worse than useless, and an over-eager tool surface is the
 * usual cause. Scored separately because the right answer here is silence.
 */
export const NO_TOOL_CASES = [
  { prompt: "What's the capital of France?", why: "Nothing to do with this workspace." },
  {
    prompt: "Thanks, that's great.",
    why: "Acknowledgement. Calling a tool here is the over-eagerness failure.",
  },
  {
    prompt: "What's the difference between a cover letter and a referral ask?",
    why: "A question about the concepts, answerable from the server instructions.",
  },
  {
    prompt: "Should I take the job or not?",
    why: "A decision that is theirs. compare_offers is right once they ask about the numbers, and a tool call here answers a question nobody asked.",
  },
];
