/** (test) The declared flow covers what the code knows (A-16): a new reader, tool, role or run kind must get its node. */
import { describe, expect, it } from "vitest";
import {
  nodeOfArea,
  nodeOfReader,
  nodeOfRole,
  nodeOfRun,
  nodeOfTool,
  PIPELINE,
  pipelineGaps,
} from "../src/pipeline.ts";
import { coreTools } from "../src/tools.ts";

describe("the flow of models and code, declared (task 59b)", () => {
  it("names a node for every reader, role, run kind, decision area and tool, and every arrow joins two nodes", () => {
    expect(pipelineGaps(coreTools().names())).toEqual([]);
  });
  it("sends each thing where it belongs", () => {
    expect(nodeOfReader("read_message")).toBe("read_message");
    expect(nodeOfReader("fill")).toBe("fill");
    expect(nodeOfReader("summarize_each")).toBe("readers");
    expect(nodeOfReader("review_reading")).toBe("reviewer");
    expect(nodeOfReader("nope")).toBeNull();
    expect(nodeOfRole("decider")).toBe("classify");
    expect(nodeOfRole("planner")).toBe("planner");
    expect(nodeOfRun("mail")).toBe("mail");
    expect(nodeOfRun("request")).toBe("conversation");
    expect(nodeOfRun("other")).toBeNull();
    expect(nodeOfTool("entities.create")).toBe("tools");
    expect(nodeOfArea("choice")).toBe("classify");
    expect(nodeOfArea("mail.accept")).toBe("inbox");
  });
  it("would refuse a reader or a tool left out, and an arrow to nowhere", () => {
    expect(pipelineGaps([...coreTools().names(), "mail.send"])).toEqual([
      "tool mail.send has no node",
    ]);
    const ids = new Set(PIPELINE.nodes.map((n) => n.id));
    for (const e of PIPELINE.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });
});
