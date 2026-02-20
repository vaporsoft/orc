import { z } from "zod";

export const ConfigSchema = z.object({
  maxLoops: z.number().int().positive().default(10),
  pollInterval: z.number().int().positive().default(30),
  debounce: z.number().int().positive().default(60),
  confidence: z.number().min(0).max(1).default(0.75),
  model: z.string().default("sonnet"),
  maxTurns: z.number().int().positive().default(30),
  claudeTimeout: z.number().int().positive().default(900),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});
