import type { buildApp } from "../src/app";

export type InjectResponse = Awaited<ReturnType<ReturnType<typeof buildApp>["inject"]>>;
