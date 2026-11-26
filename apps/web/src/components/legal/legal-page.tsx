import en from "../../../messages/en.json";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { CONTACT_EMAIL, LEGAL_UPDATED, contactHref } from "@/lib/site";

type Doc = "privacy" | "terms";

/**
 * /privacy and /terms: a title, the date of the wording, a short contents list and the sections
 * from en.json (`legal.<doc>.sections`, each a heading and numbered paragraphs). The last section
 * ends with the contact address.
 */
export function LegalPage({ doc }: { doc: Doc }) {
  const l = (key: string, params?: Record<string, string | number>) =>
    t(`legal.${key}` as MessageKey, params);
  const sections = Object.entries(en.legal[doc].sections) as [
    string,
    { heading: string; body: Record<string, string> },
  ][];
  const mail = contactHref();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{l(`${doc}.title`)}</h1>
        <p className="text-muted-foreground text-sm">
          {l("updated", { date: formatDate(LEGAL_UPDATED) })}
        </p>
        <p className="text-muted-foreground max-w-prose">{l(`${doc}.intro`)}</p>
        <nav aria-label={l("contents")} className="flex flex-wrap gap-2 pt-1">
          {sections.map(([id, section]) => (
            <a
              key={id}
              href={`#${id}`}
              className="bg-muted hover:bg-accent focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3"
            >
              {section.heading}
            </a>
          ))}
        </nav>
      </header>

      {sections.map(([id, section], index) => (
        <section key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
          <h2 id={`${id}-heading`} className="mb-3 text-xl font-semibold tracking-tight">
            {section.heading}
          </h2>
          <div className="flex max-w-prose flex-col gap-3 text-sm leading-relaxed">
            {Object.entries(section.body).map(([key, text]) => (
              <p key={key}>{text}</p>
            ))}
            {index === sections.length - 1 &&
              (mail && CONTACT_EMAIL ? (
                <p>
                  <a
                    href={mail}
                    className="font-medium underline underline-offset-4"
                    translate="no"
                  >
                    {l("emailUs", { email: CONTACT_EMAIL })}
                  </a>
                </p>
              ) : (
                <p className="text-muted-foreground">{l("contactMissing")}</p>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
