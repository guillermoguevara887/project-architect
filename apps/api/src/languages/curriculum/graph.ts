export type DirectedEdge = {
  from: string;
  to: string;
};

export function findDirectedCycle(
  nodeIds: readonly string[],
  edges: readonly DirectedEdge[],
): string[] | null {
  const adjacency = new Map<string, string[]>();

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }

  for (const edge of edges) {
    const outgoing = adjacency.get(edge.from);
    if (outgoing && adjacency.has(edge.to)) {
      outgoing.push(edge.to);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): string[] | null => {
    if (visited.has(nodeId)) {
      return null;
    }

    if (visiting.has(nodeId)) {
      const cycleStart = stack.lastIndexOf(nodeId);
      return [...stack.slice(cycleStart), nodeId];
    }

    visiting.add(nodeId);
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      const cycle = visit(next);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  };

  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}
