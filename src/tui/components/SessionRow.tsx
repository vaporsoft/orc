import React from "react";
import { Box, Text } from "ink";
import type { BranchState } from "../../types/index.js";
import { StatusBadge } from "./StatusBadge.js";

interface SessionRowProps {
  state: BranchState;
  selected: boolean;
}

export function SessionRow({ state, selected }: SessionRowProps) {
  const branch = state.branch.length > 20
    ? state.branch.slice(0, 19) + "…"
    : state.branch;

  const pr = state.prNumber ? `#${state.prNumber}` : "—";
  const iter = `${state.currentIteration}/${state.maxIterations}`;
  const cost = `$${state.totalCostUsd.toFixed(2)}`;
  const errors = state.iterations.reduce((sum, i) => sum + i.errors.length, 0);

  return (
    <Box>
      <Text color={selected ? "cyan" : undefined} bold={selected}>
        {selected ? ">" : " "}{" "}
      </Text>
      <Box width={22}>
        <Text bold={selected}>{branch}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{pr}</Text>
      </Box>
      <Box width={18}>
        <StatusBadge status={state.status} />
      </Box>
      <Box width={8}>
        <Text>{iter}</Text>
      </Box>
      <Box width={10}>
        <Text>{cost}</Text>
      </Box>
      <Box width={6}>
        <Text color={errors > 0 ? "red" : undefined}>{errors}</Text>
      </Box>
    </Box>
  );
}
