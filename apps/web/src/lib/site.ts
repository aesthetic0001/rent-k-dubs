// Who runs the site and how to reach them, shown on /privacy, /terms, the footer and each
// listing's "Report this listing" link. The address comes from the environment so it isn't
// hard-coded before the team picks one.

/** The contact address, or null until NEXT_PUBLIC_CONTACT_EMAIL is set. */
export const CONTACT_EMAIL: string | null = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

/** The date /privacy and /terms were last changed (ISO). Update it with the wording. */
export const LEGAL_UPDATED = "2026-11-24";

/** A mailto link to the contact address, or null when there is none. */
export function contactHref(subject?: string, body?: string): string | null {
  if (!CONTACT_EMAIL) return null;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${CONTACT_EMAIL}${query ? `?${query}` : ""}`;
}
