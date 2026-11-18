// vitest's limits by how loaded the machine is when the tests start: four times at least, six at most (T-11, task 134).
// The files that bound time run alone, after the rest (T-12, task 155).

import { defineConfig } from "vitest/config";
import { timeouts } from "./src/index.ts";
import { suite } from "./src/suite.ts";

export default defineConfig({ test: { ...timeouts(), ...suite(import.meta.dirname) } });
