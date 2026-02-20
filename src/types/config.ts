import { z } from "zod";

export const ConfigSchema = z.object({
  pollInterval: z.number().int().positive().default(30),
  confidence: z.number().min(0).max(1).default(0.75),
  model: z.string().default("sonnet"),
  sessionTimeout: z.number().positive().default(1),
  claudeTimeout: z.number().int().positive().default(900),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});
