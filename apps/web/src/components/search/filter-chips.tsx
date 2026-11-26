"use client";

import {
  ArrowUpDown,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  ChevronDown,
  DollarSign,
  FileText,
  House,
  MapPin,
  PawPrint,
  Ruler,
  ShieldQuestion,
  Snowflake,
  Sofa,
  SquareParking,
  Tag,
  Trash2,
  Users,
  WashingMachine,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { createElement, useId, useState } from "react";
import { SAFETY } from "@rentkdubs/shared/engine/config";
import { modeIcons } from "@/components/mode-icons";
import { SafetyLimit } from "@/components/safety/safety-limit";
import { CrimeDisclaimer } from "@/components/safety/crime-disclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t, type MessageKey } from "@/lib/format/messages";
import { runSearch } from "@/lib/store/actions";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent } from "@/lib/store/types";
import {
  MODES,
  buildChips,
  removeChip,
  setChipHard,
  setTargetMinutes,
  setTargetModes,
  type Chip,
  type Mode,
} from "./chips";
import { setSafety } from "./filters";

/** How many chip labels the collapsed summary shows before "+N more". */
const SUMMARY_CHIPS = 3;

/** An icon per kind of chip, so a row of filters can be scanned by shape as well as words. */
const criterionIcons: Record<NonNullable<Chip["field"]>, LucideIcon> = {
  rent: DollarSign,
  bedrooms: BedDouble,
  bathrooms: Bath,
  sizeSqft: Ruler,
  unitTypes: House,
  buildingAge: Building2,
  airConditioning: Snowflake,
  petsAllowed: PawPrint,
  furnished: Sofa,
  parking: SquareParking,
  laundryInSuite: WashingMachine,
  utilitiesIncluded: Zap,
  availableBy: CalendarDays,
  leaseTerm: FileText,
};

function chipIconType(chip: Chip, intent: SearchIntent): LucideIcon {
  switch (chip.kind) {
    case "criterion":
      return chip.field ? criterionIcons[chip.field] : Tag;
    case "travel": {
      const target = intent.travelTargets.find((item) => item.id === chip.targetId);
      return target ? modeIcons[target.mode] : MapPin;
    }
    case "safety":
      return ShieldQuestion;
    case "area":
      return MapPin;
    case "household":
      return Users;
    case "sort":
      return ArrowUpDown;
  }
}

function ChipIcon({ chip, intent }: { chip: Chip; intent: SearchIntent }) {
  return createElement(chipIconType(chip, intent), {
    "aria-hidden": true,
    className: "size-4 shrink-0 opacity-80",
  });
}

/** Must-have solid, preference outlined, default dashed (SPEC 6 step 2). */
function chipStyle(chip: Chip): string {
  if (chip.source === "default")
    return "border-dashed border-input text-muted-foreground bg-transparent";
  if (chip.hard === true || chip.kind === "area")
    return "border-primary bg-primary text-primary-foreground";
  if (chip.hard === false) return "border-primary bg-card text-primary";
  return "border-border bg-secondary text-secondary-foreground";
}

/**
 * The current search in a few words ("Up to $2,500, 2 bedrooms"), in the row beside Filters and
 * Sort. It opens the editable chips (`FilterChips`) below the row.
 */
export function FilterSummary({
  intent,
  open,
  onToggle,
  controls,
}: {
  intent: SearchIntent;
  open: boolean;
  onToggle: () => void;
  /** The id of the chips panel it opens. */
  controls: string;
}) {
  const chips = buildChips(intent);
  if (!chips.length) return null;
  const preview = chips.slice(0, SUMMARY_CHIPS).map((chip) => chip.label);
  const more = chips.length - preview.length;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 order-last flex min-w-0 basis-full items-center gap-1 rounded-md text-left text-sm transition-colors outline-none focus-visible:ring-3 sm:order-none sm:flex-1 sm:basis-auto"
    >
      <span className="sr-only">{t("filters.summaryLabel")}: </span>
      <span className="truncate">
        {preview.join(", ")}
        {more > 0 && ` ${t("filters.summaryMore", { count: more })}`}
      </span>
      <ChevronDown
        aria-hidden
        className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/** Editable chips for the current search. Every edit re-runs search without calling the parser. */
export function FilterChips({
  intent,
  id,
  open,
}: {
  intent: SearchIntent;
  id: string;
  open: boolean;
}) {
  const updateIntent = useAppStore((s) => s.updateIntent);
  const chips = buildChips(intent);
  if (!chips.length) return null;

  const edit = (update: (current: SearchIntent) => SearchIntent) => {
    updateIntent(update);
    void runSearch();
  };

  // Rendered while closed too, so the summary's aria-controls always points at something.
  return (
    <div
      id={id}
      role="region"
      aria-label={t("filters.summaryLabel")}
      hidden={!open}
      className="accent-trip bg-card flex flex-col rounded-2xl border px-4 py-3"
    >
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key} className="max-w-full">
            <ChipButton chip={chip} intent={intent} onEdit={edit} />
          </li>
        ))}
      </ul>
      {/* A key made of sample chips, so the three styles explain themselves. */}
      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="border-primary bg-primary h-3 w-5 rounded-full border" />
          {t("filters.legendMust")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="border-primary bg-card h-3 w-5 rounded-full border" />
          {t("filters.legendPreference")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="border-input h-3 w-5 rounded-full border border-dashed" />
          {t("filters.legendDefault")}
        </span>
        <span className="ml-auto">{t("filters.legendTap")}</span>
      </div>
    </div>
  );
}

function ChipButton({
  chip,
  intent,
  onEdit,
}: {
  chip: Chip;
  intent: SearchIntent;
  onEdit: (update: (current: SearchIntent) => SearchIntent) => void;
}) {
  const kind = chip.hard === null ? null : t(chip.hard ? "filters.mustHave" : "filters.preference");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={kind ? t("filters.chipAria", { label: chip.label, kind }) : chip.label}
          className={`focus-visible:ring-ring/50 inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border pr-3.5 pl-3 text-sm font-medium transition-colors outline-none hover:opacity-90 focus-visible:ring-3 ${chipStyle(chip)}`}
        >
          <ChipIcon chip={chip} intent={intent} />
          <span className="truncate">{chip.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{chip.label}</p>
          <SourceLine chip={chip} />
        </div>

        {chip.kind === "safety" ? (
          <>
            <CrimeDisclaimer />
            <SafetyLimit
              key={`${intent.safety.hard}-${intent.safety.maxRelativeRate ?? ""}`}
              commitOnRelease
              value={
                intent.safety.hard
                  ? (intent.safety.maxRelativeRate ?? SAFETY.hardMaxRelativeRate)
                  : null
              }
              onChange={(limit) =>
                onEdit((i) =>
                  setSafety(i, {
                    enabled: true,
                    hard: limit !== null,
                    maxRelativeRate: limit ?? undefined,
                  }),
                )
              }
            />
          </>
        ) : (
          chip.hard !== null && (
            <HardSwitch
              chip={chip}
              onChange={(hard) => onEdit((i) => setChipHard(i, chip, hard))}
            />
          )
        )}

        {chip.kind === "travel" && chip.targetId && (
          <TravelEditor
            target={intent.travelTargets.find((target) => target.id === chip.targetId)}
            onModes={(modes) => onEdit((i) => setTargetModes(i, chip.targetId!, modes))}
            onMinutes={(minutes) => onEdit((i) => setTargetMinutes(i, chip.targetId!, minutes))}
          />
        )}

        <Button
          variant="destructive"
          size="sm"
          className="self-start"
          onClick={() => onEdit((i) => removeChip(i, chip))}
        >
          <Trash2 aria-hidden data-icon="inline-start" />
          {t("filters.remove")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SourceLine({ chip }: { chip: Chip }) {
  const lines: string[] = [];
  if (chip.phrase) lines.push(t("filters.fromPrompt", { phrase: chip.phrase }));
  if (chip.source === "user") lines.push(t(chip.phrase ? "filters.edited" : "filters.fromUser"));
  if (chip.source === "default") lines.push(t("filters.fromDefault"));
  if (!lines.length) return null;
  return <p className="text-muted-foreground text-sm">{lines.join(" · ")}</p>;
}

function HardSwitch({ chip, onChange }: { chip: Chip; onChange: (hard: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{t("filters.mustHave")}</Label>
        <Switch id={id} checked={chip.hard === true} onCheckedChange={onChange} />
      </div>
      <p className="text-muted-foreground text-xs">{t("filters.mustHaveHelp")}</p>
    </div>
  );
}

export function TravelEditor({
  target,
  onModes,
  onMinutes,
}: {
  target: SearchIntent["travelTargets"][number] | undefined;
  onModes: (modes: Mode[]) => void;
  onMinutes: (minutes: number | null) => void;
}) {
  const id = useId();
  const [minutes, setMinutes] = useState(target?.maxMinutes ? String(target.maxMinutes) : "");
  if (!target) return null;
  const modes = [target.mode, ...(target.alternativeModes ?? [])];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id={`${id}-modes`}>
          {t("filters.travelModes")}
        </p>
        <ToggleGroup
          type="multiple"
          variant="outline"
          aria-labelledby={`${id}-modes`}
          value={modes}
          onValueChange={(value) => onModes(value as Mode[])}
          className="flex-wrap"
        >
          {MODES.map((mode) => {
            const Icon = modeIcons[mode];
            return (
              <ToggleGroupItem key={mode} value={mode} className="px-2.5">
                <Icon aria-hidden />
                {t(`filters.modes.${mode}` as MessageKey)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(minutes);
          onMinutes(minutes.trim() && Number.isFinite(value) && value > 0 ? value : null);
        }}
      >
        <Label htmlFor={`${id}-minutes`}>{t("filters.minutes")}</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-minutes`}
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className="figures w-24"
          />
          <Button type="submit" variant="outline">
            {t("filters.apply")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t("filters.minutesHelp")}</p>
      </form>
    </div>
  );
}
