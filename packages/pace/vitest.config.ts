// vitest's limits stretched by how loaded the machine is when the tests start, six times at most (T-11, task 134).

import { defineConfig } from "vitest/config";
import { timeouts } from "./src/index.ts";

export default defineConfig({ test: timeouts() });
