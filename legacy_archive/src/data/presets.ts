import type { WorkspacePreset } from "../types";
export const presets: WorkspacePreset[] = [
  {
    id: "overview",
    name: "Default overview",
    visible: [
      "macro",
      "sprint",
      "canvas",
      "timeline",
      "deconstructor",
      "scratchpad",
    ],
    layouts: [
      { i: "macro", x: 0, y: 0, w: 7, h: 15, minW: 4, minH: 6 },
      { i: "sprint", x: 7, y: 0, w: 5, h: 15, minW: 4, minH: 6 },
      { i: "canvas", x: 0, y: 15, w: 7, h: 14, minW: 4, minH: 6 },
      { i: "timeline", x: 7, y: 15, w: 5, h: 14, minW: 4, minH: 6 },
      { i: "deconstructor", x: 0, y: 29, w: 7, h: 11, minW: 4, minH: 6 },
      { i: "scratchpad", x: 7, y: 29, w: 5, h: 11, minW: 3, minH: 6 },
    ],
  },
  {
    id: "execution",
    name: "Sprint execution",
    visible: ["sprint", "canvas", "timeline", "deconstructor"],
    layouts: [
      { i: "sprint", x: 0, y: 0, w: 7, h: 15, minW: 4, minH: 6 },
      { i: "timeline", x: 7, y: 0, w: 5, h: 15, minW: 4, minH: 6 },
      { i: "canvas", x: 0, y: 15, w: 7, h: 14, minW: 4, minH: 6 },
      { i: "deconstructor", x: 7, y: 15, w: 5, h: 14, minW: 4, minH: 6 },
    ],
  },
  {
    id: "focus",
    name: "Deep work focus",
    visible: ["sprint", "timeline", "scratchpad"],
    layouts: [
      { i: "sprint", x: 0, y: 0, w: 7, h: 17, minW: 4, minH: 6 },
      { i: "timeline", x: 7, y: 0, w: 5, h: 17, minW: 4, minH: 6 },
      { i: "scratchpad", x: 0, y: 17, w: 12, h: 12, minW: 4, minH: 6 },
    ],
  },
];
