import { Context } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

/** Outside-context type: plain grammy context plus conversation controls. */
export type Ctx = Context & ConversationFlavor<Context>;
