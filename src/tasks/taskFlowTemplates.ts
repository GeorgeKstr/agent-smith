import type { TaskFlowTemplate, TaskFlowTemplateKind, TaskFlowTemplateFormat } from "../types/index.js";

export const TASK_FLOW_TEMPLATES: TaskFlowTemplate[] = [
  {
    id: "basic_task_list",
    title: "Basic Task List",
    description: "Simple list of tasks for quick bulk import.",
    kind: "basic_task_list",
    recommendedFormats: ["markdown", "plain", "csv"]
  },
  {
    id: "bugfix_flow",
    title: "Bugfix Flow",
    description: "Buckets: Reproduce, Inspect, Patch, Tests, Review. Good for bugfix sprints.",
    kind: "bugfix_flow",
    recommendedFormats: ["markdown", "json", "csv"]
  },
  {
    id: "feature_flow",
    title: "Feature Flow",
    description: "Buckets: Planning, API, UI, Tests, Review. For new feature development.",
    kind: "feature_flow",
    recommendedFormats: ["markdown", "json", "csv"]
  },
  {
    id: "reviewed_iteration_flow",
    title: "Reviewed Iteration Flow",
    description: "Designed for organizer tasks with implement model, review model, iterations, auto-approve/apply, and checks.",
    kind: "reviewed_iteration_flow",
    recommendedFormats: ["json", "markdown"]
  },
  {
    id: "mobile_ui_flow",
    title: "Mobile UI Flow",
    description: "Buckets: Layout, Touch UX, Diff/Code Views, Phone Testing, Polish.",
    kind: "mobile_ui_flow",
    recommendedFormats: ["markdown", "json"]
  },
  {
    id: "custom_blank",
    title: "Blank Spec",
    description: "A commented template users can edit and customize.",
    kind: "custom_blank",
    recommendedFormats: ["markdown"]
  }
];

export function getTemplate(id: string): TaskFlowTemplate | undefined {
  return TASK_FLOW_TEMPLATES.find((t) => t.id === id);
}

type TemplateContent = {
  buckets: Array<{ name: string; tasks: Array<{ title: string; prompt?: string; priority?: number }> }>;
};

function getTemplateContent(kind: TaskFlowTemplateKind): TemplateContent {
  switch (kind) {
    case "basic_task_list":
      return {
        buckets: [{
          name: "Tasks",
          tasks: [
            { title: "Review project structure and dependencies", prompt: "Identify key files and modules relevant to the task." },
            { title: "Create implementation plan", prompt: "Break down the work into concrete, testable steps.", priority: 2 },
            { title: "Write or update tests", prompt: "Add tests that validate the expected behavior and catch regressions.", priority: 2 },
            { title: "Implement changes", prompt: "Make minimal, focused changes following the plan.", priority: 2 },
            { title: "Verify with checks", prompt: "Run typecheck, tests, lint to ensure nothing is broken." }
          ]
        }]
      };
    case "bugfix_flow":
      return {
        buckets: [
          { name: "Reproduce", tasks: [{ title: "Reproduce the bug", prompt: "Document steps to reproduce and expected vs actual behavior.", priority: 3 }] },
          { name: "Inspect", tasks: [{ title: "Identify root cause", prompt: "Trace through relevant code paths to find the source of the bug." }] },
          { name: "Patch", tasks: [{ title: "Implement the fix", prompt: "Make the minimal change that addresses the root cause.", priority: 2 }] },
          { name: "Tests", tasks: [{ title: "Add regression tests", prompt: "Add tests that fail before the fix and pass after.", priority: 2 }] },
          { name: "Review", tasks: [{ title: "Review the fix", prompt: "Review the diff, check safety, run checks." }] }
        ]
      };
    case "feature_flow":
      return {
        buckets: [
          { name: "Planning", tasks: [{ title: "Specify the feature", prompt: "Document requirements, acceptance criteria, and scope.", priority: 2 }] },
          { name: "API", tasks: [{ title: "Design or update API", prompt: "Define endpoints, request/response shapes, and validation." }] },
          { name: "UI", tasks: [{ title: "Build UI components", prompt: "Implement the user-facing parts of the feature." }] },
          { name: "Tests", tasks: [{ title: "Write integration tests", prompt: "Cover the happy path and edge cases." }] },
          { name: "Review", tasks: [{ title: "Review and polish", prompt: "Review the full diff, refine UI, run full checks." }] }
        ]
      };
    case "reviewed_iteration_flow":
      return {
        buckets: [
          { name: "Planning", tasks: [{ title: "Understand the task and context", prompt: "Review the project structure, relevant files, and symbols." }] },
          { name: "Implementation", tasks: [{ title: "Implement the change", prompt: "Make minimal, testable changes.", priority: 2 }] },
          { name: "Checks", tasks: [{ title: "Run configured checks", prompt: "typecheck, test, lint as configured." }] },
          { name: "Review", tasks: [{ title: "Review and approve", prompt: "Review the diff, check safety, approve or request changes." }] }
        ]
      };
    case "mobile_ui_flow":
      return {
        buckets: [
          { name: "Layout", tasks: [{ title: "Design mobile-first layout", prompt: "Create responsive layout with single-column phone, multi-column desktop." }] },
          { name: "Touch UX", tasks: [{ title: "Ensure touch targets >= 44px", prompt: "Verify all buttons and interactive elements meet minimum touch size." }] },
          { name: "Diff/Code Views", tasks: [{ title: "Add scrollable code containers", prompt: "Code blocks and diffs must scroll inside containers, not force horizontal scroll." }] },
          { name: "Phone Testing", tasks: [{ title: "Test at 360px width", prompt: "Verify no horizontal scrolling, usable navigation, tap targets work." }] },
          { name: "Polish", tasks: [{ title: "Polish and final review", prompt: "Refine spacing, colors, and interactions for phone experience." }] }
        ]
      };
    case "custom_blank":
      return {
        buckets: [{ name: "Backlog", tasks: [{ title: "Replace with your first task", prompt: "Describe what needs to be done." }] }]
      };
  }
}

export function getTemplateBucketsAndTasks(kind: TaskFlowTemplateKind): TemplateContent {
  return getTemplateContent(kind);
}
