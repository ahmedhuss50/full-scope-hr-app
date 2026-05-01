-- 005_interviews.sql
-- Interview scheduling, capture, transcription, scorecards, decisions.

create type interview_status_enum as enum (
  'slots_proposed','scheduled','completed','no_show','cancelled'
);

create type interview_type_enum as enum (
  'phone_screen','in_person','video','technical','case_study','panel'
);

create type interview_decision_enum as enum (
  'hire','no_hire','next_round','hold'
);

create table interviews (
  id                       uuid primary key default uuid_generate_v4(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  application_id           uuid not null references applications(id) on delete cascade,
  interviewer_user_id      uuid references users(id),
  interview_type           interview_type_enum not null default 'in_person',
  scheduled_start          timestamptz,
  scheduled_end            timestamptz,
  calcom_booking_id        text,
  calcom_event_url         text,
  status                   interview_status_enum not null default 'slots_proposed',
  location_id              uuid references work_locations(id),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table interview_slots (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  interview_id  uuid not null references interviews(id) on delete cascade,
  slot_start    timestamptz not null,
  slot_end      timestamptz not null,
  selected      boolean not null default false,
  declined      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table interview_recordings (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  interview_id      uuid not null references interviews(id) on delete cascade,
  audio_file_ref    text not null,
  provider          text,
  duration_seconds  numeric,
  mime_type         text,
  created_at        timestamptz not null default now()
);

create table interview_transcripts (
  id                        uuid primary key default uuid_generate_v4(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  interview_recording_id    uuid not null references interview_recordings(id) on delete cascade,
  provider                  text not null,
  language_detected         text,                                      -- 'en' | 'ar' | mixed
  full_text_file_ref        text,
  segments                  jsonb,
  created_at                timestamptz not null default now()
);

create table interview_scorecards (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  interview_id     uuid not null references interviews(id) on delete cascade,
  scores           jsonb not null,
  recommendation   interview_decision_enum,
  summary_text     text,
  red_flags        text[],
  model_used       text,
  generated_at     timestamptz not null default now()
);

create table interview_decisions (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  interview_id      uuid not null references interviews(id) on delete cascade,
  decision          interview_decision_enum not null,
  decided_by_user_id uuid references users(id),
  notes             text,
  decided_at        timestamptz not null default now()
);

create trigger trg_interviews_updated_at before update on interviews for each row execute function set_updated_at();
