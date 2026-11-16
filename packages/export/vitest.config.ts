// vitest's limits stretched by how loaded the machine is when the tests start, six times at most (T-11, task 134).
import { timeouts } from "@boni/pace";
import { defineConfig } from "vitest/config";

export default defineConfig({ test: timeouts() });
