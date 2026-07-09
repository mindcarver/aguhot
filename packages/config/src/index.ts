/**
 * @aguhot/config — typed environment parsing and (future) feature flags.
 *
 * @see ./env.ts for the env contract.
 */
export {
  envSchema,
  loadEnv,
  requireEnv,
  resetEnvCache,
  type Env,
} from "./env.js";
