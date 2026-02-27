/**
 * Zod schema definitions for SF2WD mapping profiles.
 * This is the authoritative runtime validator. Used both at runtime and
 * (eventually) by the Monaco Editor for live validation.
 */
import { z } from 'zod'

// ── Rule schemas ──────────────────────────────────────────────────────────────

export const DirectRuleSchema = z.object({
  type: z.literal('direct'),
  sourceField: z.string().min(1),
})

export const ConstantRuleSchema = z.object({
  type: z.literal('constant'),
  value: z.string(),
})

export const LookupRuleSchema = z.object({
  type: z.literal('lookup'),
  sourceField: z.string().min(1),
  /** Name of a lookup table defined in `profile.lookupTables`. */
  table: z.string().min(1),
  /** Fallback value when the source key is not found in the table. */
  default: z.string().optional(),
  /** Behaviour when the key is missing and no default is provided. */
  onMissing: z.enum(['warn', 'error']).default('warn'),
})

export const ConcatRuleSchema = z.object({
  type: z.literal('concat'),
  /**
   * Ordered list of parts. Each part is either:
   * - a source field name (no spaces, matches column headers), or
   * - a string literal (enclosed in double quotes in the JSON).
   * Distinguish them at runtime: if the part is enclosed in " " it's a literal.
   */
  parts: z.array(z.string()).min(1),
})

export const DateFormatRuleSchema = z.object({
  type: z.literal('dateFormat'),
  sourceField: z.string().min(1),
  inputFormat: z.string().min(1),
  outputFormat: z.string().min(1),
})

export const SplitRuleSchema = z.object({
  type: z.literal('split'),
  sourceField: z.string().min(1),
  delimiter: z.string().min(1),
  index: z.number().int().min(0),
})

export const ConditionSchema = z.object({
  if: z.object({
    field: z.string().min(1),
    equals: z.string().optional(),
    contains: z.string().optional(),
    regex: z.string().optional(),
    isEmpty: z.boolean().optional(),
  }),
  then: z.string(),
})

export const ConditionalRuleSchema = z.object({
  type: z.literal('conditional'),
  conditions: z.array(ConditionSchema).min(1),
  else: z.string(),
})

export const RegexRuleSchema = z.object({
  type: z.literal('regex'),
  sourceField: z.string().min(1),
  pattern: z.string().min(1),
  captureGroup: z.number().int().min(0).default(1),
})

export const ExprRuleSchema = z.object({
  type: z.literal('expr'),
  expression: z.string().min(1),
})

export const RuleSchema = z.discriminatedUnion('type', [
  DirectRuleSchema,
  ConstantRuleSchema,
  LookupRuleSchema,
  ConcatRuleSchema,
  DateFormatRuleSchema,
  SplitRuleSchema,
  ConditionalRuleSchema,
  RegexRuleSchema,
  ExprRuleSchema,
])

// ── Template reference ────────────────────────────────────────────────────────

export const TemplateRefSchema = z.object({
  /** e.g. "sap-successfactors", "workday", "adp" */
  system: z.string().min(1),
  /** e.g. "ec-employee-export", "eib-worker" */
  template: z.string().min(1),
})

// ── Field mapping ─────────────────────────────────────────────────────────────

export const FieldMappingSchema = z.object({
  targetField: z.string().min(1),
  rule: RuleSchema,
  notes: z.string().optional(),
})

// ── Profile settings ──────────────────────────────────────────────────────────

export const ProfileSettingsSchema = z.object({
  onValidationError: z.enum(['skip', 'halt', 'include']).default('skip'),
  dateLocale: z.string().default('en-US'),
  emptySourceValue: z
    .array(z.union([z.string(), z.null()]))
    .default(['', null]),
  enableExprRules: z.boolean().default(false),
})

// ── Top-level profile ─────────────────────────────────────────────────────────

export const ProfileSchema = z.object({
  profileId: z.string().min(1),
  description: z.string(),
  version: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.string().optional(),
  source: TemplateRefSchema,
  target: TemplateRefSchema,
  settings: ProfileSettingsSchema.default({}),
  lookupTables: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  fieldMappings: z.array(FieldMappingSchema),
})

// ── TypeScript types derived from schemas ─────────────────────────────────────

export type DirectRule = z.infer<typeof DirectRuleSchema>
export type ConstantRule = z.infer<typeof ConstantRuleSchema>
export type LookupRule = z.infer<typeof LookupRuleSchema>
export type ConcatRule = z.infer<typeof ConcatRuleSchema>
export type DateFormatRule = z.infer<typeof DateFormatRuleSchema>
export type SplitRule = z.infer<typeof SplitRuleSchema>
export type ConditionalRule = z.infer<typeof ConditionalRuleSchema>
export type RegexRule = z.infer<typeof RegexRuleSchema>
export type ExprRule = z.infer<typeof ExprRuleSchema>
export type Rule = z.infer<typeof RuleSchema>
export type TemplateRef = z.infer<typeof TemplateRefSchema>
export type FieldMapping = z.infer<typeof FieldMappingSchema>
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>
export type Profile = z.infer<typeof ProfileSchema>
