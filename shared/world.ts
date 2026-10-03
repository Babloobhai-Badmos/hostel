// The one hostel map, built from the JSON data files. Imported by both the
// server and the client so they share identical collision and object data.

import layout from "./layout.json";
import tasks from "./tasks.json";
import { buildHostelMap } from "./buildMap";
import type { LayoutDef, TaskDef } from "./buildMap";

export const TASKS: TaskDef[] = tasks as TaskDef[];
export const hostelMap = buildHostelMap(layout as unknown as LayoutDef, TASKS);
