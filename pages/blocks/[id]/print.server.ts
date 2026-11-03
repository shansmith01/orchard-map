import { defineHead } from "void";
import type { Props } from "../[id].server";

export { loader, type Props } from "../[id].server";

// The browser uses the title as the default PDF file name.
export const head = defineHead<Props>((_c, { block, orchardName }) => ({ title: `${orchardName} – ${block.name} map` }));
