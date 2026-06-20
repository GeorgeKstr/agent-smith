export function canCreateFilesForTask(input: {
  prompt: string;
  taskGoal?: string;
}): boolean {
  const text = `${input.prompt}\n${input.taskGoal ?? ""}`.toLowerCase();

  return (
    /\b(create|add|new|generate|write|scaffold)\b/.test(text) &&
    /\b(file|component|page|module|script|test|doc|readme|\.txt\b|\.md\b|\.ts\b|\.tsx\b|\.js\b|\.json\b|\.css\b|\.html\b)\b/.test(text)
  );
}
