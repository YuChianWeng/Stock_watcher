import type { Route } from "../router";
export type Ctx = { route: Route; el: HTMLElement; setTop: (html: string) => void; alive: () => boolean };
export type View = (ctx: Ctx) => (() => void) | void | Promise<(() => void) | void>;
