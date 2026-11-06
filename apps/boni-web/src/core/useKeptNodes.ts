/**
 * The nodes of a canvas whose boxes the code places (the flow editor, Boni's map): React Flow measures each box and
 * says so through `onNodesChange`; a node made again without its measure is hidden until measured anew, and one whose
 * size did not change is never measured again (2026-11-06: the map opened on a centre came out empty). So the nodes
 * the code makes are kept as React Flow's state, each new one with the measure of the one it replaces.
 */
import { applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

export function useKeptNodes<N extends Node>(made: N[]) {
  const [nodes, setNodes] = useState<N[]>(made);
  useEffect(() => {
    setNodes((was) => {
      const by = new Map(was.map((n) => [n.id, n]));
      return made.map((n) => {
        const old = by.get(n.id);
        return old?.measured && !n.measured ? { ...n, measured: old.measured } : n;
      });
    });
  }, [made]);
  const onNodesChange = useCallback(
    (changes: NodeChange<N>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  return { nodes, onNodesChange };
}
