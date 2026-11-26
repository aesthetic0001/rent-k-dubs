import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("legal.privacy.title") };

export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
