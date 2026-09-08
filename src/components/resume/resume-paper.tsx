import { cn, dateRange } from "@/lib/utils";
import type { ResumeDoc, ResumeSection } from "@/lib/resume-schema";

export type PaperSettings = {
  template: string;
  accent: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  /**
   * The owner's headshot as a data URI, or "" for no photo. Resolved by the
   * data layer from Profile.photo when the document has showPhoto on, so the
   * picture is never copied into a saved document and one replacement updates
   * every resume that shows it.
   */
  photo?: string;
};

/**
 * Templates that will draw a photo.
 *
 * Harvard is absent on purpose and not as an oversight: the format is a US
 * academic convention, and a face on it is the one thing that marks a document
 * as not-that-format. A resume can carry showPhoto and still render none here.
 */
const PHOTO_TEMPLATES = ["classic", "modern", "compact", "editorial"];

const FONT_CLASS: Record<string, string> = {
  inter: "font-inter",
  serif: "font-serif-resume",
  mono: "font-mono-resume",
};

const MUTED = "#494d59";
const FAINT = "#5c6070";

/**
 * The document itself. Deliberately styled with plain CSS values rather than
 * Tailwind spacing tokens so that what you see on screen is exactly what the
 * browser prints at 8.5in × 11in.
 *
 * `harvard` is a faithful port of the Harvard OCS format: everything one size,
 * name and section headings centred over full-width rules, and each entry laid
 * out as two justified lines — organisation/location, then role/dates.
 */
export function ResumePaper({
  doc,
  settings,
  className,
  linkify = false,
}: {
  doc: ResumeDoc;
  settings: PaperSettings;
  className?: string;
  /**
   * Render URLs as real anchors. Off by default: thumbnails and the editor
   * preview live inside their own <Link>, and nesting anchors is invalid HTML.
   * The print route turns it on so the exported PDF keeps clickable links.
   */
  linkify?: boolean;
}) {
  const { template, accent, fontFamily, fontSize, lineHeight, pageMargin } = settings;
  const photo = PHOTO_TEMPLATES.includes(template) ? (settings.photo ?? "") : "";
  // The raw index is carried through: `data-rp` addresses doc.sections[i], and
  // filtering first would renumber them. It also replaces section.id as the
  // React key — ids default to "" and RESUME_DOC_SHAPE never mentions them, so
  // every document written through create_resume keys its list on one value.
  const sections = doc.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible && hasContent(section));

  return (
    <div
      className={cn(
        "resume-paper",
        FONT_CLASS[fontFamily] ?? FONT_CLASS.inter,
        template === "harvard" && "resume-paper--harvard",
        className,
      )}
      style={
        {
          "--paper-accent": accent,
          "--paper-size": fontSize,
          "--paper-leading": lineHeight,
          padding: `${pageMargin}px`,
        } as React.CSSProperties
      }
    >
      <Header doc={doc} template={template} linkify={linkify} photo={photo} />

      <div style={{ marginTop: template === "harvard" ? "0.95em" : "1.15em" }}>
        {sections.map(({ section, index }, position) => (
          <SectionBlock
            key={index}
            section={section}
            sectionIndex={index}
            template={template}
            linkify={linkify}
            first={position === 0}
          />
        ))}
      </div>
    </div>
  );
}

/** An anchor when we're allowed one, a plain span otherwise. */
function Url({
  href,
  linkify,
  style,
  children,
}: {
  href: string;
  linkify: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!linkify) return <span style={style}>{children}</span>;
  return (
    <a href={href} style={style}>
      {children}
    </a>
  );
}

/** The two justified lines every Harvard entry is built from. */
function EntryLine({
  left,
  right,
  boldLeft = false,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  boldLeft?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1em" }}>
      <span style={{ fontWeight: boldLeft ? 700 : 400 }}>{left}</span>
      {right ? <span style={{ whiteSpace: "nowrap" }}>{right}</span> : null}
    </div>
  );
}

/**
 * The headshot, sized in em so it scales with the document's text size rather
 * than fighting it. `print-color-adjust` is what stops a browser dropping the
 * image when it prints "background graphics off"; the src is a data URI, so
 * nothing is fetched and the picture survives the unauthenticated public page
 * and the headless-browser PDF alike.
 */
function Photo({ src, alt, size, round }: { src: string; alt: string; size: string; round: boolean }) {
  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: size,
        height: size,
        objectFit: "cover",
        borderRadius: round ? "50%" : "0.25em",
        flexShrink: 0,
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    />
  );
}

function Header({
  doc,
  template,
  linkify,
  photo,
}: {
  doc: ResumeDoc;
  template: string;
  linkify: boolean;
  photo: string;
}) {
  const { header } = doc;
  const contacts = [header.location, header.email, header.phone].filter(Boolean);
  const centered = template === "classic" || template === "harvard";
  const editorial = template === "editorial";
  const photoAlt = header.name ? `${header.name}` : "";

  // Harvard: name over a full-width rule, contact line centred beneath it,
  // every item the same size, separated by bullets.
  if (template === "harvard") {
    return (
      <header className="rp-block" data-rp="header" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1em", fontWeight: 700, lineHeight: 1.2 }}>
          {header.name || "Your Name"}
        </h1>

        {header.title && <div style={{ marginTop: "0.1em" }}>{header.title}</div>}

        <div
          style={{
            marginTop: "0.28em",
            borderBottom: "1px solid var(--paper-accent)",
          }}
        />

        <div
          style={{
            marginTop: "0.55em",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: "0.42em",
          }}
        >
          {contacts.map((item, index) => (
            <span key={`${item}-${index}`}>
              {item}
              {index < contacts.length + header.links.length - 1 && (
                <span style={{ marginLeft: "0.42em" }}>&bull;</span>
              )}
            </span>
          ))}
          {header.links.map((link, index) => (
            <span key={`${link.url}-${index}`}>
              <Url href={link.url} linkify={linkify} style={{ color: "var(--paper-accent)" }}>
                {link.label || stripProtocol(link.url)}
              </Url>
              {index < header.links.length - 1 && (
                <span style={{ marginLeft: "0.42em" }}>&bull;</span>
              )}
            </span>
          ))}
        </div>
      </header>
    );
  }

  // Centred templates stack the photo over the name; the left-aligned ones set
  // it beside the text, which is the only arrangement that does not push the
  // contact line onto a second row.
  const inner = (
    <>
      {photo && centered && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.6em" }}>
          <Photo src={photo} alt={photoAlt} size="4.6em" round />
        </div>
      )}
      <h1
        style={{
          fontSize: editorial ? "2.55em" : "1.95em",
          fontWeight: editorial ? 400 : 700,
          letterSpacing: editorial ? "-0.02em" : "-0.015em",
          lineHeight: 1.05,
        }}
      >
        {header.name || "Your Name"}
      </h1>

      {header.title && (
        <div
          className="rp-heading"
          style={{
            fontSize: "0.86em",
            marginTop: editorial ? "0.5em" : "0.28em",
            letterSpacing: "0.11em",
          }}
        >
          {header.title}
        </div>
      )}

      <div
        style={{
          marginTop: "0.55em",
          fontSize: "0.9em",
          color: MUTED,
          display: "flex",
          flexWrap: "wrap",
          gap: "0 0.75em",
          justifyContent: centered ? "center" : "flex-start",
        }}
      >
        {contacts.map((item, index) => (
          <span key={`${item}-${index}`}>
            {item}
            {index < contacts.length + header.links.length - 1 && (
              <span style={{ opacity: 0.4, marginLeft: "0.75em" }}>·</span>
            )}
          </span>
        ))}
        {header.links.map((link, index) => (
          <span key={`${link.url}-${index}`}>
            <Url href={link.url} linkify={linkify} style={{ color: "var(--paper-accent)" }}>
              {link.label || stripProtocol(link.url)}
            </Url>
            {index < header.links.length - 1 && (
              <span style={{ opacity: 0.4, marginLeft: "0.75em" }}>·</span>
            )}
          </span>
        ))}
      </div>
    </>
  );

  return (
    <header className={cn("rp-block", centered && "text-center")} data-rp="header">
      {photo && !centered ? (
        <div style={{ display: "flex", alignItems: "center", gap: editorial ? "1.1em" : "0.9em" }}>
          <div style={{ minWidth: 0, flex: 1 }}>{inner}</div>
          <Photo
            src={photo}
            alt={photoAlt}
            size={editorial ? "5.4em" : "4.4em"}
            round={!editorial}
          />
        </div>
      ) : (
        inner
      )}

      {template !== "editorial" && <div className="rp-rule" style={{ marginTop: "0.85em" }} />}
    </header>
  );
}

function SectionBlock({
  section,
  sectionIndex,
  template,
  linkify,
  first,
}: {
  section: ResumeSection;
  /** Index into doc.sections, so `data-rp` names a place in the document. */
  sectionIndex: number;
  template: string;
  linkify: boolean;
  first: boolean;
}) {
  const at = `s${sectionIndex}`;
  const harvard = template === "harvard";
  const tight = template === "compact";
  const gap = harvard ? "0.85em" : tight ? "0.65em" : "0.95em";
  const entryGap = harvard ? "0.45em" : tight ? "0.5em" : "0.7em";

  return (
    <section data-rp={at} style={{ marginBottom: gap, marginTop: harvard && !first ? "0.85em" : 0 }}>
      <SectionHeading heading={section.heading} template={template} />

      {section.kind === "summary" && (
        <p
          data-rp={`${at}/text`}
          style={{ marginTop: harvard ? "0.3em" : "0.35em", color: harvard ? "inherit" : "#33363f" }}
        >
          {section.text}
        </p>
      )}

      {section.kind === "experience" &&
        section.experience.map((item, index) => (
          <article
            key={index}
            className="rp-block"
            data-rp={`${at}/e${index}`}
            style={{ marginTop: index === 0 ? (harvard ? "0.35em" : entryGap) : entryGap }}
          >
            {harvard ? (
              <>
                <EntryLine left={item.company} right={item.location} boldLeft />
                <EntryLine
                  left={item.title}
                  right={dateRange(item.startDate, item.endDate, item.isCurrent)}
                  boldLeft
                />
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "1em",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {item.title}
                    {item.company && (
                      <span style={{ fontWeight: 500, color: MUTED }}>
                        {" · "}
                        {item.company}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.88em", color: FAINT, whiteSpace: "nowrap" }}>
                    {dateRange(item.startDate, item.endDate, item.isCurrent)}
                  </div>
                </div>
                {item.location && (
                  <div style={{ fontSize: "0.88em", color: "#6b6f7d" }}>{item.location}</div>
                )}
              </>
            )}

            {item.summary && (
              <p style={{ marginTop: "0.22em", color: harvard ? "inherit" : "#33363f" }}>
                {item.summary}
              </p>
            )}

            <Bullets items={item.bullets} tight={tight || harvard} harvard={harvard} at={`${at}/e${index}`} />
          </article>
        ))}

      {section.kind === "education" &&
        section.education.map((item, index) => (
          <article
            key={index}
            className="rp-block"
            data-rp={`${at}/d${index}`}
            style={{
              marginTop: index === 0 ? (harvard ? "0.35em" : tight ? "0.42em" : "0.6em") : harvard ? "0.45em" : tight ? "0.42em" : "0.6em",
            }}
          >
            {harvard ? (
              <>
                <EntryLine left={item.school} right={item.location} boldLeft />
                {(item.degree || item.field) && (
                  <EntryLine
                    left={[item.degree, item.field].filter(Boolean).join(" in ")}
                    right={dateRange(item.startDate, item.endDate)}
                  />
                )}
                {/* Harvard runs thesis / coursework as plain lines, not bullets. */}
                {item.details
                  .filter((detail) => detail.trim())
                  .map((detail, detailIndex) => (
                    <div key={detailIndex}>{detail}</div>
                  ))}
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "1em",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{item.school}</div>
                  <div style={{ fontSize: "0.88em", color: FAINT, whiteSpace: "nowrap" }}>
                    {dateRange(item.startDate, item.endDate)}
                  </div>
                </div>
                {(item.degree || item.field) && (
                  <div style={{ color: MUTED }}>
                    {[item.degree, item.field].filter(Boolean).join(", ")}
                    {item.location && <span style={{ color: "#6b6f7d" }}> · {item.location}</span>}
                  </div>
                )}
                <Bullets items={item.details} tight={tight} at={`${at}/d${index}`} />
              </>
            )}
          </article>
        ))}

      {section.kind === "projects" &&
        section.projects.map((item, index) => (
          <article
            key={index}
            className="rp-block"
            data-rp={`${at}/p${index}`}
            style={{
              marginTop: index === 0 ? (harvard ? "0.35em" : tight ? "0.45em" : "0.62em") : harvard ? "0.45em" : tight ? "0.45em" : "0.62em",
            }}
          >
            {harvard ? (
              <>
                <EntryLine
                  left={item.name}
                  right={
                    item.url ? (
                      <Url href={item.url} linkify={linkify} style={{ color: "var(--paper-accent)" }}>
                        {stripProtocol(item.url)}
                      </Url>
                    ) : undefined
                  }
                  boldLeft
                />
                {(item.role || item.description) && (
                  <EntryLine
                    left={item.role || item.description}
                    right={dateRange(item.startDate, item.endDate)}
                    boldLeft
                  />
                )}
                {item.role && item.description && <div>{item.description}</div>}
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "1em",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {item.name}
                    {item.role && (
                      <span style={{ fontWeight: 500, color: MUTED }}>
                        {" · "}
                        {item.role}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.88em", color: FAINT, whiteSpace: "nowrap" }}>
                    {dateRange(item.startDate, item.endDate)}
                  </div>
                </div>
                {item.url && (
                  <Url
                    href={item.url}
                    linkify={linkify}
                    style={{
                      display: "block",
                      fontSize: "0.88em",
                      color: "var(--paper-accent)",
                    }}
                  >
                    {stripProtocol(item.url)}
                  </Url>
                )}
                {item.description && (
                  <p style={{ marginTop: "0.2em", color: "#33363f" }}>{item.description}</p>
                )}
              </>
            )}

            <Bullets items={item.bullets} tight={tight || harvard} harvard={harvard} at={`${at}/p${index}`} />
          </article>
        ))}

      {section.kind === "skills" && (
        <div
          style={{
            marginTop: harvard ? "0.3em" : "0.35em",
            display: "grid",
            gridTemplateColumns: template === "compact" ? "1fr 1fr" : "1fr",
            columnGap: "1.4em",
            rowGap: harvard ? "0.12em" : "0.22em",
          }}
        >
          {section.skills.map((group, index) => (
            <div key={index} className="rp-block" data-rp={`${at}/k${index}`}>
              {group.name && <span style={{ fontWeight: 700 }}>{group.name}:&nbsp;</span>}
              <span style={{ color: harvard ? "inherit" : "#33363f" }}>{group.skills.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {section.kind === "certifications" && (
        <div style={{ marginTop: harvard ? "0.3em" : "0.35em" }}>
          {section.certifications.map((item, index) => (
            <div
              key={index}
              className="rp-block"
              data-rp={`${at}/c${index}`}
              style={{ display: "flex", justifyContent: "space-between", gap: "1em" }}
            >
              <span>
                <span style={{ fontWeight: harvard ? 700 : 600 }}>{item.name}</span>
                {item.issuer && (
                  <span style={{ color: harvard ? "inherit" : FAINT }}>
                    {harvard ? ", " : " · "}
                    {item.issuer}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: harvard ? "1em" : "0.88em",
                  color: harvard ? "inherit" : FAINT,
                  whiteSpace: "nowrap",
                }}
              >
                {item.date}
              </span>
            </div>
          ))}
        </div>
      )}

      {section.kind === "custom" &&
        section.items.map((item, index) => (
          <article
            key={index}
            className="rp-block"
            data-rp={`${at}/x${index}`}
            style={{ marginTop: index === 0 ? (harvard ? "0.35em" : "0.55em") : harvard ? "0.45em" : "0.55em" }}
          >
            {harvard ? (
              <>
                <EntryLine left={item.title} right={item.meta} boldLeft />
                {item.subtitle && <EntryLine left={item.subtitle} boldLeft />}
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "1em",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {item.title}
                  {item.subtitle && (
                    <span style={{ fontWeight: 500, color: MUTED }}>
                      {" · "}
                      {item.subtitle}
                    </span>
                  )}
                </div>
                {item.meta && (
                  <div style={{ fontSize: "0.88em", color: FAINT, whiteSpace: "nowrap" }}>
                    {item.meta}
                  </div>
                )}
              </div>
            )}
            <Bullets items={item.bullets} tight={tight || harvard} harvard={harvard} at={`${at}/x${index}`} />
          </article>
        ))}
    </section>
  );
}

function SectionHeading({ heading, template }: { heading: string; template: string }) {
  if (!heading) return null;

  // Harvard: centred, same size as the body, over a full-width rule.
  if (template === "harvard") {
    return (
      <>
        <h2 style={{ fontSize: "1.1em", fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>
          {heading}
        </h2>
        <div style={{ borderBottom: "1px solid var(--paper-accent)", marginTop: "0.1em" }} />
      </>
    );
  }

  if (template === "editorial") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.7em" }}>
        <h2 className="rp-heading" style={{ fontSize: "0.78em", whiteSpace: "nowrap" }}>
          {heading}
        </h2>
        <span
          style={{
            flex: 1,
            height: 1,
            background: "color-mix(in srgb, var(--paper-accent) 35%, #d9dbe3)",
          }}
        />
      </div>
    );
  }

  if (template === "modern") {
    return (
      <h2
        className="rp-heading"
        style={{
          fontSize: "0.78em",
          borderLeft: "2.5px solid var(--paper-accent)",
          paddingLeft: "0.5em",
        }}
      >
        {heading}
      </h2>
    );
  }

  return (
    <>
      <h2 className="rp-heading" style={{ fontSize: "0.78em" }}>
        {heading}
      </h2>
      <div className="rp-rule" style={{ marginTop: "0.16em" }} />
    </>
  );
}

function Bullets({
  items,
  tight,
  harvard = false,
  at,
}: {
  items: string[];
  tight: boolean;
  harvard?: boolean;
  /** The parent entry's path; each bullet hangs off it as `/b<n>`. */
  at?: string;
}) {
  // Indexed before the blanks are dropped, so a path names the bullet's real
  // position in the document rather than its position among the printed ones.
  const clean = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.trim());
  if (clean.length === 0) return null;
  return (
    <ul style={{ marginTop: tight ? "0.18em" : "0.28em" }}>
      {clean.map(({ item, index }) => (
        <li
          key={index}
          className="rp-bullet"
          data-rp={at ? `${at}/b${index}` : undefined}
          style={{ color: harvard ? "inherit" : "#33363f", marginTop: "0.12em" }}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function hasContent(section: ResumeSection) {
  switch (section.kind) {
    case "summary":
      return Boolean(section.text.trim());
    case "experience":
      return section.experience.length > 0;
    case "education":
      return section.education.length > 0;
    case "projects":
      return section.projects.length > 0;
    case "skills":
      return section.skills.some((group) => group.skills.length > 0);
    case "certifications":
      return section.certifications.length > 0;
    case "custom":
      return section.items.length > 0;
    default:
      return false;
  }
}

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
