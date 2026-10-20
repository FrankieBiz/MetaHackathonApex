# Study triage and syllabus scanning

Select a course in the order book, then use **⚡ Study Triage** in TaskTree or
**Generate Study Triage** in the command palette. Courses without assignments are
selectable. A study indicator appears for courses with no deadlines in the next
seven days, or an exam due in the next fourteen days. Overdue work counts as an
immediate deadline.

`POST /api/v1/triage/study` accepts:

```json
{
  "course_id": "cs3801",
  "course_name": "Distributed Systems",
  "recent_assignments": [
    {
      "title": "Consensus problem set",
      "description": "Raft and quorum intersection",
      "score": 12,
      "points_possible": 20,
      "status": "completed"
    }
  ],
  "syllabus_text": "Study Guide: Distributed_Systems_Midterm_Guide.pdf (4.2MB)"
}
```

Assignment scores are raw points. Below 70% triggers a weak-performance signal;
ungraded and zero-point work does not. Optional `due_at` accepts timezone-aware
ISO timestamps, and `weight` is a percentage of the course grade. The scanner
flags study guide, exam, midterm, final, and rubric references, plus PDF filenames
and supplied sizes (large means at least 2MB). PDF references are scanned in supplied
text; PDF downloads and binary text extraction are outside this endpoint. Canvas
syllabus and assignment text retain PDF links and actual submission scores.

The response includes server-detected `detected_triggers`, exactly three
`focus_topics`, two or three atomic `recommended_blocks` with
`estimated_minutes: 25`, `course_id`, `source`, and `inference_telemetry`.
Generation uses the existing Meta/Llama configuration. Timeouts, invalid output,
or provider errors return a labeled local starter with null token usage.
Telemetry measures output tokens over the full request round trip.

The preview leaves task progress untouched. **Insert study blocks** calls
`POST /api/v1/triage/study/insert` with `course_id` and `recommended_blocks`.
It appends course-scoped study recommendations to the normal persisted terminal
state and returns that state. Repeated insertion preserves existing progress
and avoids duplicates. Blocks support the existing subtask PATCH endpoint,
completion controls, and time logs, and survive course syncs and snapshot restores.

Study generation requires a backend connection. A pinned local simulation desk
does not make model or backend requests. Previews remain scoped to their course
when selection changes, and are discarded when the dataset changes.

Run `make check` to verify the backend, frontend, and production build.
