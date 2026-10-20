-- Apply manually in the Supabase SQL editor before enabling persistence.
create table if not exists public.apex_terminal_state (
    id text primary key,
    payload jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.apex_terminal_state enable row level security;
revoke all on public.apex_terminal_state from anon, authenticated;
-- Only the backend's service_role key can access snapshots. Never send it to a browser.
grant select, insert, update on public.apex_terminal_state to service_role;

-- ---------------------------------------------------------------------------
-- Relational mirror. PATCH /api/v1/subtasks/{id} writes the touched assignment's
-- tree here and appends a time log, in one transaction. The snapshot above stays
-- the restore source.
-- ---------------------------------------------------------------------------

create table if not exists public.courses (
    id text primary key,
    course_code text not null,
    name text not null,
    -- Null until Canvas posts a grade.
    current_score numeric check (current_score >= 0),
    target_score numeric not null default 90.0 check (target_score between 0 and 100),
    updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
    id text primary key,
    course_id text not null references public.courses (id) on delete cascade,
    title text not null,
    due_at timestamptz,
    points_possible numeric not null default 0 check (points_possible >= 0),
    -- Percent of the final grade, 0-100.
    weight numeric not null default 0 check (weight between 0 and 100),
    description text,
    status text not null default 'pending'
        check (status in ('pending', 'in_progress', 'completed')),
    -- Scored or excused by Canvas; a submission awaiting a grade is completed, not graded.
    graded boolean not null default false,
    priority_score numeric not null default 0,
    updated_at timestamptz not null default now()
);

-- Text IDs: Llama plans use uuid5 strings, the sandbox fixtures use positional IDs.
create table if not exists public.subtasks (
    id text primary key,
    assignment_id text not null references public.assignments (id) on delete cascade,
    parent_id text references public.subtasks (id) on delete cascade,
    title text not null,
    estimated_minutes integer not null default 30 check (estimated_minutes >= 0),
    actual_minutes integer not null default 0 check (actual_minutes >= 0),
    is_completed boolean not null default false,
    is_study_recommendation boolean not null default false,
    position integer not null default 0,
    updated_at timestamptz not null default now(),
    check (parent_id <> id)
);

-- One row per PATCH that changed a subtask. minutes_delta is signed, so a -15m
-- correction is recorded rather than erased; actual_minutes is the total after it.
create table if not exists public.time_logs (
    id uuid primary key default gen_random_uuid(),
    subtask_id text not null references public.subtasks (id) on delete cascade,
    minutes_delta integer not null,
    actual_minutes integer not null check (actual_minutes >= 0),
    is_completed boolean not null,
    logged_at timestamptz not null default now()
);

create index if not exists assignments_course_id_idx on public.assignments (course_id);
create index if not exists subtasks_assignment_id_idx on public.subtasks (assignment_id);
create index if not exists subtasks_parent_id_idx on public.subtasks (parent_id);
create index if not exists time_logs_subtask_id_idx on public.time_logs (subtask_id, logged_at);

-- Upserts the course, the assignment, and its whole subtask tree (a checkbox can
-- cascade through every level), prunes nodes no longer in the tree, and appends
-- the time log. Unchanged rows keep their updated_at.
create or replace function public.apex_record_subtask_patch(
    p_course jsonb,
    p_assignment jsonb,
    p_subtasks jsonb,
    p_time_log jsonb
) returns void
language plpgsql
set search_path = ''
as $$
declare
    v_assignment_id text := p_assignment ->> 'id';
begin
    insert into public.courses as t (id, course_code, name, current_score, target_score)
    select r.id, r.course_code, r.name, r.current_score, r.target_score
    from jsonb_populate_record(null::public.courses, p_course) r
    on conflict (id) do update set
        course_code = excluded.course_code,
        name = excluded.name,
        current_score = excluded.current_score,
        target_score = excluded.target_score,
        updated_at = now()
    where (t.course_code, t.name, t.current_score, t.target_score)
        is distinct from
        (excluded.course_code, excluded.name, excluded.current_score, excluded.target_score);

    insert into public.assignments as t (
        id, course_id, title, due_at, points_possible, weight, description, status,
        graded, priority_score
    )
    select r.id, r.course_id, r.title, r.due_at, r.points_possible, r.weight,
        r.description, r.status, r.graded, r.priority_score
    from jsonb_populate_record(null::public.assignments, p_assignment) r
    on conflict (id) do update set
        course_id = excluded.course_id,
        title = excluded.title,
        due_at = excluded.due_at,
        points_possible = excluded.points_possible,
        weight = excluded.weight,
        description = excluded.description,
        status = excluded.status,
        graded = excluded.graded,
        priority_score = excluded.priority_score,
        updated_at = now()
    where (t.course_id, t.title, t.due_at, t.points_possible, t.weight, t.description,
            t.status, t.graded, t.priority_score)
        is distinct from
        (excluded.course_id, excluded.title, excluded.due_at, excluded.points_possible,
            excluded.weight, excluded.description, excluded.status, excluded.graded,
            excluded.priority_score);

    -- Foreign keys are checked at the end of the statement, so parents and
    -- children can arrive in one insert in any order.
    insert into public.subtasks as t (
        id, assignment_id, parent_id, title, estimated_minutes, actual_minutes,
        is_completed, is_study_recommendation, position
    )
    select r.id, v_assignment_id, r.parent_id, r.title, r.estimated_minutes,
        r.actual_minutes, r.is_completed, r.is_study_recommendation, r.position
    from jsonb_populate_recordset(null::public.subtasks, p_subtasks) r
    on conflict (id) do update set
        assignment_id = excluded.assignment_id,
        parent_id = excluded.parent_id,
        title = excluded.title,
        estimated_minutes = excluded.estimated_minutes,
        actual_minutes = excluded.actual_minutes,
        is_completed = excluded.is_completed,
        is_study_recommendation = excluded.is_study_recommendation,
        position = excluded.position,
        updated_at = now()
    where (t.assignment_id, t.parent_id, t.title, t.estimated_minutes, t.actual_minutes,
            t.is_completed, t.is_study_recommendation, t.position)
        is distinct from
        (excluded.assignment_id, excluded.parent_id, excluded.title,
            excluded.estimated_minutes, excluded.actual_minutes, excluded.is_completed,
            excluded.is_study_recommendation, excluded.position);

    delete from public.subtasks s
    where s.assignment_id = v_assignment_id
        and s.id not in (select node ->> 'id' from jsonb_array_elements(p_subtasks) node);

    insert into public.time_logs (subtask_id, minutes_delta, actual_minutes, is_completed)
    select r.subtask_id, r.minutes_delta, r.actual_minutes, r.is_completed
    from jsonb_populate_record(null::public.time_logs, p_time_log) r;
end;
$$;

alter table public.courses enable row level security;
alter table public.assignments enable row level security;
alter table public.subtasks enable row level security;
alter table public.time_logs enable row level security;
-- Supabase's default privileges grant ALL on new public tables to these roles,
-- service_role included, so start from nothing and grant back only what is used.
revoke all on public.courses, public.assignments, public.subtasks, public.time_logs
    from anon, authenticated, service_role;
grant select, insert, update, delete on public.courses, public.assignments, public.subtasks
    to service_role;
-- The ledger is append-only for the backend; rows leave only with their subtask.
grant select, insert on public.time_logs to service_role;

-- Functions are executable by PUBLIC by default.
revoke all on function public.apex_record_subtask_patch(jsonb, jsonb, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.apex_record_subtask_patch(jsonb, jsonb, jsonb, jsonb)
    to service_role;
