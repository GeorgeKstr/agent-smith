export function isNoEditTask(input: {
  mode: "ask" | "patch";
  taskGoal: string;
  successCriteria: string[];
  nonGoals: string[];
}): boolean {
  if (input.mode === "ask") return true;

  const text = [
    input.taskGoal,
    ...input.successCriteria,
    ...input.nonGoals,
  ].join("\n").toLowerCase();

  return (
    text.includes("explain") ||
    text.includes("review") ||
    text.includes("analyze") ||
    text.includes("diagnose") ||
    text.includes("what is") ||
    text.includes("how does") ||
    text.includes("why") ||
    text.includes("no code changes") ||
    text.includes("do not edit") ||
    text.includes("do not modify")
  );
}
