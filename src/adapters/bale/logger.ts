import { config } from "@/lib/config";
import { createChannelLogger } from "../logger";

/** Bale-flavoured logger: same shared format, `[bale]` prefix. */
const logger = createChannelLogger("bale", config.secretTokens);

export const baleLog = logger.log;
export const baleWarn = logger.warn;
export const baleError = logger.error;
