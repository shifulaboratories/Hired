/**
 * A job posting, as the terms it actually leans on.
 *
 * Pure text, no database, no userId — and that is the point of it being its own
 * file rather than living in analytics.ts. `transferables.ts` needs the same
 * extractor for one posting that `skillsGap` needs for all of them, and
 * importing analytics.ts to get it dragged schedule.ts, accounts.ts and
 * imapflow into the client bundle through me.ts. The build caught it as
 * "Can't resolve 'tls'", which is a long way from the edge somebody added.
 *
 * One extractor, because two would mean two answers to "does this posting want
 * Kubernetes" and the one nobody was looking at would be the one that drifted.
 */

/**
 * Words that carry no information about a job.
 *
 * NOT quick-log.ts's STOPWORDS, which stops "engineer", "software" and
 * "manager" because it is trying not to mistake a role title for a company
 * name. Those are exactly the words that matter here. Two vocabularies for two
 * questions is not a fork; a fork would be two answers to one question.
 */
const POSTING_NOISE = new Set([
  "a", "about", "across", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been",
  "being", "both", "but", "by", "can", "do", "does", "each", "for", "from", "has", "have", "how",
  "if", "in", "into", "is", "it", "its", "may", "more", "most", "must", "no", "not", "of", "on",
  "or", "other", "our", "out", "over", "per", "plus", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through", "to", "up", "us",
  "use", "using", "we", "well", "what", "when", "where", "which", "while", "who", "will", "with",
  "within", "would", "you", "your",
  // Job-posting furniture: present in every listing, meaningless as a signal.
  "ability", "able", "apply", "benefits", "candidate", "candidates", "company", "compensation",
  "equal", "etc", "excellent", "experience", "including", "job", "looking", "opportunity",
  "position", "preferred", "qualifications", "requirements", "required", "responsibilities",
  "role", "salary", "strong", "team", "teams", "work", "working", "years",
]);

/**
 * One posting as runs of words, split wherever a bigram must not span.
 *
 * The runs matter. A first version split on every non-word character and then
 * paired adjacent words, which turned "Kubernetes, Postgres and distributed
 * systems" into the term "kubernetes postgres" — two items of a list read as a
 * phrase. That is not a nitpick: the bigram then has the same document
 * frequency as "kubernetes", swallows it by the rule below, and the report
 * offers a skill nobody has ever asked for while hiding the one they did.
 * So a comma, a full stop, a slash, a bracket or a newline ends a run.
 */
function runsIn(text: string): string[][] {
  // Defensive: htmlToText already strips tags on capture, but a description
  // pasted straight into update_application has been through nothing.
  const clean = text.replace(/<[^>]*>/g, " ").toLowerCase();
  return clean
    .split(/[,;:.!?()[\]{}"'|/\\\n\r•]+/)
    .map((run) =>
      run
        .split(/[^a-z0-9+#.-]+/)
        .map((word) => word.replace(/^[.+#-]+|[.+#-]+$/g, ""))
        .filter((word) => word.length >= 2 && !/^\d+$/.test(word)),
    )
    .filter((run) => run.length > 0);
}

/** The distinct terms one posting contains: unigrams, plus bigrams of two real words. */
export function termsIn(text: string): Set<string> {
  const terms = new Set<string>();
  for (const run of runsIn(text)) {
    for (let i = 0; i < run.length; i += 1) {
      const word = run[i];
      if (!POSTING_NOISE.has(word)) terms.add(word);
      const next = run[i + 1];
      if (next && !POSTING_NOISE.has(word) && !POSTING_NOISE.has(next)) terms.add(`${word} ${next}`);
    }
  }
  return terms;
}
