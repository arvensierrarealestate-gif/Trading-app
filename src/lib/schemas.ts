import { z } from "zod";

// Request-body validation for the API routes. Reject malformed input with a
// clean 400 before any Anthropic/Alpaca work happens.

const MAX_IMAGE_B64 = 7_000_000; // ~5 MB decoded
const MAX_FILE_B64 = 8_000_000;
const MAX_CSV_TEXT = 200_000;
const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export const imageSchema = z.object({
  data: z.string().min(1, "image data is empty").max(MAX_IMAGE_B64, "image too large"),
  media_type: z.enum(ALLOWED_MEDIA),
});

// SOP fields come from our own client and feed a prompt template — stay lenient
// (coerce anything odd to "") so a quirky field never blocks grading.
const sopField = z.string().catch("");
export const sopSchema = z.object({
  assets: sopField,
  tf: sopField,
  sessions: sopField,
  entry_signals: sopField,
  entry_confirm: sopField,
  entry_notes: sopField,
  tp: sopField,
  sl: sopField,
  rr: sopField,
  risk: sopField,
  max_trades: sopField,
  drawdown: sopField,
  regimes: sopField,
  strategy_type: z.string().optional(),
});

export const gradeSchema = z.object({
  sop: sopSchema,
  asset: z.string().catch(""),
  dir: z.string().catch(""),
  outcome: z.string().catch(""),
  entry: z.string().optional(),
  exit: z.string().optional(),
  stop_loss: z.string().optional(),
  chart: imageSchema,
  news: imageSchema.nullish(),
  news_text: z.string().max(4000).optional(),
  current_regime: z.string().nullish(),
  mode: z.enum(["learner", "trader"]).optional(),
  strategy_label: z.string().max(40).optional(),
  criteria: z.array(z.string().max(160)).max(12).optional(),
});

export const recommendStopSchema = z.object({
  chart: imageSchema,
  asset: z.string().optional(),
  dir: z.string().optional(),
  entry: z.string().optional(),
});

export const tickerInsightSchema = z.object({
  symbol: z.string().trim().min(1, "symbol is required").max(12, "symbol too long"),
  aggression_score: z.number().optional(),
  atr_pct: z.number().optional(),
  beta: z.number().optional(),
  scalp_suitable: z.boolean().optional(),
  swing_suitable: z.boolean().optional(),
  sop: z
    .object({ regimes: z.string().optional(), tf: z.string().optional(), assets: z.string().optional() })
    .optional(),
  stats: z
    .object({
      win_rate: z.number().nullish(),
      max_single_loss: z.number().nullish(),
      primary_assets: z.string().nullish(),
    })
    .nullish(),
  regime: z.string().nullish(),
});

const uploadFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf"), name: z.string(), data: z.string().min(1).max(MAX_FILE_B64, "PDF too large") }),
  z.object({
    kind: z.literal("image"),
    name: z.string(),
    media_type: z.enum(ALLOWED_MEDIA),
    data: z.string().min(1).max(MAX_FILE_B64, "image too large"),
  }),
  z.object({ kind: z.literal("csv"), name: z.string(), text: z.string().max(MAX_CSV_TEXT, "CSV too large") }),
]);

export const verifyTradesSchema = z.object({
  files: z.array(uploadFileSchema).min(1, "upload at least one file").max(8, "max 8 files"),
});

// Validate `raw` against `schema`; on failure return the first issue as a
// human-readable string suitable for a 400 response.
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const path = issue.path.join(".");
  return { ok: false, error: path ? `${path}: ${issue.message}` : issue.message };
}
