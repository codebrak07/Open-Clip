import { z } from 'zod';

export type MetricFormat = 'indian_grouping' | 'plain' | 'percent' | 'ordinal' | 'currency_inr' | 'k_m';
export type MetricDirection = 'lower_is_better' | 'higher_is_better';
export type DisplayType = 'tag' | 'meter' | 'badge' | 'body_scale';

export const StatusTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  minVal: z.number(),
  maxVal: z.number(),
  color: z.string().min(1), // Hex code or catalog color
});

export const SocietalIronySchema = z.object({
  roleOrJob: z.string().min(1),
  value: z.number(),
  effect: z.string().min(1),
});

export const ConcealmentSchema = z.object({
  mechanic: z.string().min(1),
  item: z.string().min(1), // Must map to concealer catalog id
  reactions: z.array(z.string().min(1)).min(1),
});

export const SetPieceSchema = z.object({
  id: z.string().min(1),
  location: z.string().min(1),  // Catalog location id
  formation: z.string().min(1), // Catalog formation id
  gag: z.string().min(1),
  escalation: z.string().min(1),
});

export const WorldConceptSchema = z.object({
  tag: z.string().min(1),
  openingLine: z.string().refine(
    (val) => /^In this world,\s+/i.test(val),
    { message: 'openingLine must begin with "In this world, "' }
  ),
  metric: z.object({
    name: z.string().min(1),
    format: z.enum(['indian_grouping', 'plain', 'percent', 'ordinal', 'currency_inr', 'k_m']),
    direction: z.enum(['lower_is_better', 'higher_is_better']),
    min: z.number(),
    max: z.number(),
  }),
  display: z.enum(['tag', 'meter', 'badge', 'body_scale']),
  tiers: z.array(StatusTierSchema).min(3, 'Must have at least 3 tiers covering min..max with no gaps or overlaps'),
  effects: z.object({
    housing: z.record(z.string()),   // tierId -> home catalog id
    elevation: z.record(z.string()), // tierId -> platform catalog id
    treatment: z.record(z.string()), // tierId -> treatment catalog id
  }),
  ironies: z.array(SocietalIronySchema).min(1, 'Must include at least 1 societal irony'),
  concealment: ConcealmentSchema,
  setPieces: z.array(SetPieceSchema).min(3).max(4),
  twist: z.string().min(1),
  buttonGag: z.string().min(1),
  callback: z.string().min(1, 'Opening rule must pay off in the ending'),
});

export type WorldConcept = z.infer<typeof WorldConceptSchema>;
export type StatusTier = z.infer<typeof StatusTierSchema>;
