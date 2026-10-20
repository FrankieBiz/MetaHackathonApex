import type { CanvasAssignment, ScheduleEvent } from "../src/types.js";
import { requestPublic } from "./network.js";
interface Course {
  id: number;
  name: string;
  course_code?: string;
}
interface Assignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  description: string | null;
  html_url?: string;
  published?: boolean;
  rubric?: { description: string; points: number }[];
  submission?: { workflow_state?: string; submitted_at?: string | null };
}
interface Upcoming {
  id: number;
  title: string;
  start_at: string;
  end_at?: string;
  context_code?: string;
  assignment?: Assignment;
}
const plainText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
export function validateCanvasDomain(raw: string) {
  const domain = raw
    .trim()
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.instructure\.com$/.test(domain))
    throw new Error(
      "Use your school’s Canvas domain, such as school.instructure.com.",
    );
  return domain;
}
async function pages<T>(
  origin: string,
  path: string,
  token: string,
  deadline: number,
): Promise<T[]> {
  let url = new URL(path, origin).toString();
  const items: T[] = [];
  for (let page = 0; page < 10; page++) {
    if (new URL(url).origin !== origin)
      throw new Error("Unexpected Canvas pagination domain.");
    const response = await requestPublic(url, token, 0, deadline);
    const data: unknown = JSON.parse(response.text);
    if (!Array.isArray(data))
      throw new Error("Canvas returned an unexpected response.");
    items.push(...(data as T[]));
    const next = String(response.headers.link || "")
      .split(",")
      .find((l) => /rel="next"/.test(l))
      ?.match(/<([^>]+)>/)?.[1];
    if (!next) return items;
    url = next;
  }
  throw new Error(
    "Canvas returned too many pages. Archive old courses and try again.",
  );
}
export async function syncCanvas(rawDomain: string, token: string) {
  const domain = validateCanvasDomain(rawDomain),
    origin = `https://${domain}`;
  if (!token.trim() || token.length > 2048 || /[\r\n]/.test(token))
    throw new Error("Enter a valid Canvas personal access token.");
  const deadline = Date.now() + 50_000;
  const [courses, upcoming] = await Promise.all([
    pages<Course>(
      origin,
      "/api/v1/courses?enrollment_state=active&per_page=100",
      token,
      deadline,
    ),
    pages<Upcoming>(
      origin,
      "/api/v1/users/self/upcoming_events?per_page=100",
      token,
      deadline,
    ),
  ]);
  if (courses.length > 100)
    throw new Error(
      "Too many active courses. Archive inactive courses and try again.",
    );
  const assignments: CanvasAssignment[] = [];
  for (let index = 0; index < courses.length; index += 4) {
    const batches = await Promise.all(
      courses.slice(index, index + 4).map(async (course, i) => ({
        course,
        color: ["violet", "cyan", "amber", "emerald"][(index + i) % 4],
        data: await pages<Assignment>(
          origin,
          `/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`,
          token,
          deadline,
        ),
      })),
    );
    batches.forEach(({ course, color, data }) =>
      data.forEach((a) => {
        if (
          !a.due_at ||
          a.published === false ||
          Number.isNaN(new Date(a.due_at).getTime())
        )
          return;
        const description = a.description || "";
        const attachments = Array.from(
          description.matchAll(
            /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          ),
        ).flatMap((m) => {
          try {
            const url = new URL(m[1], origin);
            return url.protocol === "https:" && !url.username && !url.password
              ? [
                  {
                    url: url.toString(),
                    title: plainText(m[2]) || "Attachment",
                  },
                ]
              : [];
          } catch {
            return [];
          }
        });
        assignments.push({
          id: `canvas-${domain}-${course.id}-${a.id}`,
          title: a.name,
          course: course.course_code || course.name,
          courseId: course.id,
          color,
          dueAt: a.due_at,
          points: a.points_possible,
          description: plainText(description),
          completed:
            !!a.submission?.submitted_at ||
            ["submitted", "graded", "pending_review"].includes(
              a.submission?.workflow_state || "",
            ),
          source: "canvas",
          url: a.html_url,
          rubric: (a.rubric || []).map((r) => ({
            title: r.description,
            points: r.points,
          })),
          attachments,
        });
      }),
    );
  }
  const events: ScheduleEvent[] = upcoming
    .filter(
      (e) =>
        !e.assignment &&
        e.start_at &&
        !Number.isNaN(new Date(e.start_at).getTime()),
    )
    .map((e) => ({
      id: `import-canvas-${domain}-${e.id}`,
      title: e.title,
      start: e.start_at,
      end:
        e.end_at && new Date(e.end_at) > new Date(e.start_at)
          ? e.end_at
          : new Date(new Date(e.start_at).getTime() + 3600_000).toISOString(),
      category: "Academics",
      type: "commitment",
    }));
  return { assignments, events };
}
