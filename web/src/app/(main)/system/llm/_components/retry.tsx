"use client";

// Shared LLM retry controls: attempts and interval for each of five layers.
//
// From innermost to outermost: connect (SDK) → empty response (SDK) → same-provider safety window → circuit breaker → intent rerun.
// The first three follow each endpoint, so each model can override the global defaults; the last two are process-wide.
//
// All inputs use the same "blank = unset" semantics as db.RetryRule:
//   Attempts  blank/0 = built-in default | -1 = disable this retry layer | >0 = use this count
//   Interval  blank/0 = exponential backoff | >0 = use this fixed millisecond interval

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** Where this retry layer runs and who executes it. */
  where: string;
  /** Which errors reach this layer, including status codes. */
  trigger: string;
  /** Similar errors that do not reach this layer. */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** Default attempts shown in the placeholder. */
  defAttempts: number;
  /** Default interval strategy shown in the placeholder. */
  defInterval: string;
  /** Meaning of setting attempts to -1. */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: "Connection retry",
    where: "SDK · before receiving 200",
    trigger:
      "Connection failures before receiving 200: connection resets, read/write timeouts, DNS failures, and HTTP 408, 429, 500, 502, 503, or 504.",
    skips: "Other status codes (400 / 401 / 403 / 404 / 413 / 422 and similar) are deterministic rejections; retrying would fail the same way and the error is surfaced immediately.",
    desc: "Resends the same request unchanged. Once a stream starts after receiving 200, mid-stream disconnects are handled by another layer.",
    attemptsLabel: "Retry attempts",
    defAttempts: 3,
    defInterval: "0.5s→1s→2s exponential (capped at 8s)",
    offHint: "-1 = never retry; surface failures immediately",
  },
  empty: {
    title: "Empty-response retry",
    where: "SDK · OpenAI format only",
    trigger:
      "HTTP 200 with a normal finish_reason of stop, but no content blocks in the response: gateway empty frames, dropped reasoning fields, and sampling glitches can all look this way.",
    skips: "Responses empty because max_tokens truncated them are excluded; increase the output limit instead, since retrying would hit the same limit again.",
    desc: "Resends the entire prompt, so retries are expensive for long contexts and the attempt count should stay low.",
    attemptsLabel: "Retry attempts",
    defAttempts: 2,
    defInterval: "0.5s→1s→2s exponential (capped at 8s)",
    offHint: "-1 = return empty responses unchanged",
  },
  stream: {
    title: "Same-provider safety-window retry",
    where: "This app · before output is delivered",
    trigger:
      "A failure occurs after the stream is established (200 received): mid-stream disconnects, an overloaded provider, or 429 / 5xx error events, before any token reaches the caller.",
    skips:
      "Insufficient quota (402 / insufficient_quota, handled by provider rotation), oversized context (413 / context length, handled by compaction), and deterministic 400 / 401 / 403 / 404 / 422 rejections do not retry.",
    desc: "Replays the same request with the same profile. Because no output has been delivered, replaying cannot duplicate model output or tool execution.",
    attemptsLabel: "Retry attempts",
    defAttempts: 2,
    defInterval: "0.5s→1s exponential (capped at 4s)",
    offHint: "-1 = pass stream failures directly to the outer intent rerun",
  },
  breaker: {
    title: "Provider-rotation circuit breaker",
    where: "This app · process-wide, one global policy",
    trigger:
      "Trips when transient failures (429, 5xx, or network errors) reach the consecutive threshold; deterministic failures such as insufficient balance (402), invalid keys (401 / 403), or missing models (404) trip it on the first failure.",
    skips: "One success resets the count, so an occasionally failing profile does not slowly accumulate toward the breaker threshold.",
    desc: "After tripping, the profile enters a cooldown and provider rotation skips it during that period. The state is persisted across restarts.",
    attemptsLabel: "Consecutive failures",
    defAttempts: 3,
    defInterval: "1min→5min→30min progression",
    offHint: "-1 = never trip on transient failures (deterministic failures still trip)",
  },
  intent: {
    title: "Intent rerun",
    where: "This app · process-wide, one global policy",
    trigger:
      "The earlier layers could not recover the failure: the worker ends with model_error because inner retries were exhausted, or the stream failed after output started (replay is unsafe, so the entire intent must restart).",
    skips: "Insufficient quota is handled by provider rotation and is not rerun here; paused, terminated, or finalizing tasks yield immediately without consuming backoff time.",
    desc: "Reruns the entire intent from the beginning. As the outermost layer, one rerun multiplies the work performed by the inner layers.",
    attemptsLabel: "Rerun attempts",
    defAttempts: 2,
    defInterval: "Fixed 3s",
    offHint: "-1 = do not rerun; mark the intent as blocked",
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** Human-readable milliseconds shown beside the input. */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** Controlled number input: keep intermediate values such as "-" and "1e" local. */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Follow a new value from the parent when a policy or profile changes; local typing does not reach this path.
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** Controls for one retry layer. idPrefix keeps label htmlFor values unique. */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = compact profile-drawer layout with only the layer trigger description. */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* Explain the exact status codes handled by this layer so configuration changes are understandable. */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">Triggers</span>: {meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Skipped</span>: {meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={`Default ${meta.defAttempts}`}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            Interval (ms)
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder="Default backoff"
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">{human ? `Fixed ${human}` : meta.defInterval}</span>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground text-xs">Blank = use default; {meta.offHint}.</p>}
    </div>
  );
}

/** The three endpoint-level overrides in the model configuration drawer. */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">Retry overrides</Label>
        <p className="text-muted-foreground text-xs">
          Only affects this profile and overrides the global defaults in “Retry and backoff”. Blank = follow global settings; attempts -1 = disable the layer; a specified interval replaces exponential backoff. The circuit breaker and intent rerun are process-wide and can only be changed on the global panel.
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** Global defaults for all five layers in the Retry and backoff tab. */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(`Failed to load retry policy: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The backend clamps out-of-range values and returns the saved policy, so refresh from that response.
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success("Saved and active immediately (the current call still uses the previous settings)");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading retry policy…
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        A failed model call passes through five retry layers from inner to outer:
        <span className="text-foreground"> connection → empty response → same-provider safety window → circuit breaker → intent rerun</span>
        . Outer layers run only after inner layers are exhausted, so attempt counts
        <span className="text-foreground"> multiply</span>
        —maxing out every layer can consume dozens of requests for one transient failure.
        Leaving everything blank preserves the current defaults and behavior. The first three layers can be overridden per model.
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          Save
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          Restore all defaults
        </Button>
      </div>
    </div>
  );
}
