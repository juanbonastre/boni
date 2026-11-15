// What the canvas does to a draft (docs/automatizaciones.md §5.7). Pending: the first PR of F14b brings one test per
// rule, and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads them).
import { describe, it } from "vitest";

describe("adding, connecting and removing", () => {
  it.todo(
    "AU-65 · a step is added in four ways and each gives the same step: from the top (connected to nothing), from an output (hung from it), on an arrow (between its two ends, the arrow made two) and on the canvas (connected to nothing)",
  );
  it.todo(
    "AU-65 · the first step of an empty canvas is a trigger, and adding another trigger connects it to nothing",
  );
  it.todo(
    "AU-87 · a new step has the catalogue's defaults and nothing else: no option is added, no step is added with it, and no edit adds a step that was not asked for",
  );
  it.todo(
    "AU-66 · removing a step with one arrow in and one out joins its two neighbours by the output and the input they used; in any other case its arrows go with it",
  );
  it.todo(
    "AU-66 · turning a step off and on changes only its setting «Apagado», and an arrow that would close a cycle is refused saying why",
  );
});

describe("copying, pasting and undoing", () => {
  it.todo(
    "AU-68 · copied steps take the arrows between them and no other; pasted, each has a new id, a name with a number where the name is taken, and the citations inside the clip follow the new names",
  );
  it.todo("AU-68 · a clip pastes into another automation, and «Duplicar» is copy and paste in one");
});

describe("a step's parameters and its name", () => {
  it.todo(
    "AU-76 · an option is added by setting it and taken away by removing its key: it is its default again, and it is offered again",
  );
  it.todo(
    "AU-82 · changing the action keeps the parameters the two share and names the ones that go, in the panel's order: only those that had a value Juan wrote",
  );
  it.todo(
    "AU-86 · the name follows the parameters while it is the automatic one (the collection changes, the name changes) and stops once Juan writes another; a rename rewrites every citation of the step",
  );
});
