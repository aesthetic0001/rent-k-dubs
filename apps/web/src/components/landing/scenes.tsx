import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { t, type MessageKey } from "@/lib/format/messages";
import { LakeScene } from "./lake";
import { IonTrain } from "./skyline";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Counts shown in the hero's band; null when the database can't be read. */
export type HeroStats = { listings: number; neighbourhoods: number; sources: number } | null;

const compact = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 });

/** Morning mist on Silver Lake: the headline on the open water, the pine and the bank beside it. */
export function HeroScene({ stats }: { stats: HeroStats }) {
  return (
    <section data-scene data-still="0" className="scene scene-hero" aria-labelledby="hero-title">
      <div className="scene-stage">
        <div className="hero-sky" />
        <LakeScene className="hero-art" />
        <div className="hero-grain" aria-hidden />
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-title text-balance">
            {t("landing.title")}
          </h1>
          <p className="hero-lede text-pretty">{t("landing.hero.lede")}</p>
          <a href="#start" className="hero-cta">
            {t("landing.hero.cta")}
            <ArrowRight aria-hidden className="size-5" />
          </a>
        </div>
        <div className="hero-band">
          {stats && (
            <dl className="hero-stats">
              {(["listings", "neighbourhoods", "sources"] as const).map((key) => (
                <div key={key} className="hero-stat">
                  <dt>{t(`landing.hero.stats.${key}` as MessageKey)}</dt>
                  <dd>{compact.format(stats[key]).replace("K", "k")}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="hero-note">
            <p className="text-pretty">{t("landing.paste.body")}</p>
            <Link href="/paste" className="hero-note-link">
              {t("landing.paste.title")}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const chips = [
  { id: "beds", must: true, x: "18%", y: "30%", depth: 1.6 },
  { id: "near", must: false, x: "76%", y: "24%", depth: 2.6 },
  { id: "rent", must: true, x: "30%", y: "68%", depth: 2.1 },
  { id: "pets", must: true, x: "72%", y: "62%", depth: 1.2 },
  { id: "ac", must: false, x: "52%", y: "46%", depth: 3 },
] as const;

/** The prompt types itself out as you scroll, then breaks into filter chips. */
export function SayScene() {
  const prompt = t("landing.say.prompt");
  const phrases = chips.map((c) => t(`landing.say.chips.${c.id}.phrase` as MessageKey));
  // Split the prompt into plain text and the phrases that become chips.
  const pattern = new RegExp(`(${phrases.map((p) => p.replace(/[$.]/g, "\\$&")).join("|")})`);
  const parts = prompt.split(pattern).filter(Boolean);
  let index = 0;

  return (
    <section data-scene className="scene scene-say" aria-labelledby="say-title">
      <div className="scene-stage">
        <h2 id="say-title" className="say-title">
          {t("landing.say.title")}
        </h2>
        <p className="say-prompt">
          <span className="sr-only">{prompt}</span>
          <span aria-hidden>
            {parts.map((part, i) => {
              const chars = Array.from(part).map((ch) => (
                <span key={index} className="ch" style={{ "--t": index++ / prompt.length } as Vars}>
                  {ch}
                </span>
              ));
              return phrases.includes(part) ? (
                <span key={i} className="phrase">
                  {chars}
                </span>
              ) : (
                chars
              );
            })}
          </span>
        </p>
        <ul className="say-chips">
          {chips.map((c) => (
            <li
              key={c.id}
              className={c.must ? "chip chip-must" : "chip"}
              style={{ "--x": c.x, "--y": c.y, "--d": c.depth } as Vars}
            >
              {t(`landing.say.chips.${c.id}.label` as MessageKey)}
            </li>
          ))}
        </ul>
        <p className="say-caption">{t("landing.say.caption")}</p>
      </div>
    </section>
  );
}

const r = (key: string) => t(`landing.result.${key}` as MessageKey);

/**
 * An ION train drives across and pulls the page from the deep water into the morning, which holds
 * what comes back for the request typed in the scene before: one result with its price check and
 * its trip to campus. The figures illustrate that request; they are not a live listing.
 */
export function RideScene() {
  return (
    <section data-scene className="scene scene-ride" aria-labelledby="result-title">
      <div className="scene-stage">
        <div className="ride-morning" />
        <div className="wire" aria-hidden />
        <IonTrain className="train" />
        <div className="result">
          <h2 id="result-title" className="result-title">
            {r("title")}
          </h2>
          <article className="result-card" aria-label={r("label")}>
            <svg className="result-map" viewBox="0 0 320 132" role="img" aria-label={r("map")}>
              <path
                className="result-streets"
                d="M0 28H320M0 74H320M0 112H320M46 0V132M128 0V132M214 0V132M282 0V132"
              />
              <path className="result-route" d="M70 104H128V52H214V30H258" />
              <circle className="result-home" cx="70" cy="104" r="7" />
              <circle className="result-campus" cx="258" cy="30" r="9" />
              <text className="result-campus-label" x="258" y="16" textAnchor="middle">
                UW
              </text>
            </svg>
            <div className="result-body">
              <div className="result-head">
                <div className="min-w-0">
                  <h3 className="result-name">{r("name")}</h3>
                  <p className="result-area">{r("area")}</p>
                </div>
                <p className="result-rent">
                  {r("rent")}
                  <span>{r("perMonth")}</span>
                </p>
              </div>
              <div className="result-price">
                <p>{r("price")}</p>
                <div className="result-range" aria-hidden>
                  <span className="result-range-you" />
                  <span className="result-range-typical" />
                </div>
                <p className="result-range-labels" aria-hidden>
                  <span>{r("low")}</span>
                  <span>{r("typical")}</span>
                </p>
              </div>
              <p className="result-trip">{r("trip")}</p>
              <p className="result-facts">{r("facts")}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
