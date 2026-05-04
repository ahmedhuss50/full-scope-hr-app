-- 022_portal_seed.sql
-- Client Portal seed for the Full Scope tenant. Invites the PRIMARY contact at
-- each of the 6 clients seeded in 016 + 020, then layers ~10 access-log entries
-- across the last 14 days so /portal/dashboard renders meaningfully.
--
-- Today (per session): 2026-05-04. Dates are anchored to that.
--
-- RUN ORDER: depends on 001..021 (portal schema) + 016 (clients) + 020 (CRM seed).
--
-- Contacts invited (all is_primary = true):
--   k.aldosari@aramco-services.sa     — Khalid Al-Dosari, Aramco
--   m.alsheikh@stc.com.sa             — Maha Al-Sheikh,    STC
--   aalfaisal@afh-holding.sa          — Abdullah Al-Faisal, Al-Faisal Holding
--   s.alqahtani@diriyah-build.sa      — Saad Al-Qahtani,   Diriyah Construction
--   r.alotaibi@neom-tech.sa           — Reem Al-Otaibi,    NEOM Tech
--   m.alharbi@rsg-hospitality.sa      — Mansour Al-Harbi,  RSG Hospitality

-- ============================================================
-- 1) Invite the 6 primary contacts
-- ============================================================
insert into portal_invitations (
  tenant_id, client_id, contact_id, email, invited_by_user_id,
  invited_at, first_login_at, last_login_at, active
)
select
  '11111111-1111-1111-1111-111111111111',
  c.client_id,
  c.id,
  c.email,
  '22222222-0000-0000-0000-000000000003',  -- Managing Partner invited them
  now() - interval '30 days',
  now() - interval '25 days',
  now() - interval '2 days',
  true
from crm_contacts c
where c.tenant_id = '11111111-1111-1111-1111-111111111111'
  and c.is_primary = true;

-- ============================================================
-- 2) ~10 access-log entries across the last 14 days
--    Mix of login / view_engagement / view_document / download_document.
--    entity_id is left null where the engagement/document UUIDs aren't
--    deterministic across re-seeds (the page renders fine without it).
-- ============================================================
insert into portal_access_log (
  tenant_id, client_id, contact_id, action, entity_kind, entity_id,
  ip_address, user_agent, occurred_at
) values
  -- Khalid (Aramco) — most active
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    '11aa1111-0000-0000-0000-000000000001',
    'login',             null, null,
    '85.222.10.14', 'Mozilla/5.0 (Macintosh)', now() - interval '13 days'),
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    '11aa1111-0000-0000-0000-000000000001',
    'view_engagement',   'engagement', 'eeeeeeee-0000-0000-0000-000000000001',
    '85.222.10.14', 'Mozilla/5.0 (Macintosh)', now() - interval '13 days' + interval '4 minutes'),
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    '11aa1111-0000-0000-0000-000000000001',
    'view_document',     'document',   null,
    '85.222.10.14', 'Mozilla/5.0 (Macintosh)', now() - interval '8 days'),

  -- Maha (STC)
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    '11aa1111-0000-0000-0000-000000000003',
    'login',             null, null,
    '212.118.4.91', 'Mozilla/5.0 (Windows NT 10.0)', now() - interval '11 days'),
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    '11aa1111-0000-0000-0000-000000000003',
    'download_document', 'document',   null,
    '212.118.4.91', 'Mozilla/5.0 (Windows NT 10.0)', now() - interval '11 days' + interval '7 minutes'),

  -- Abdullah (Al-Faisal)
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003',
    '11aa1111-0000-0000-0000-000000000005',
    'login',             null, null,
    '94.97.55.28', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)', now() - interval '6 days'),
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003',
    '11aa1111-0000-0000-0000-000000000005',
    'view_engagement',   'engagement', null,
    '94.97.55.28', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)', now() - interval '6 days' + interval '2 minutes'),

  -- Saad (Diriyah)
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004',
    '11aa1111-0000-0000-0000-000000000007',
    'login',             null, null,
    '37.16.122.71', 'Mozilla/5.0 (Macintosh)', now() - interval '4 days'),
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004',
    '11aa1111-0000-0000-0000-000000000007',
    'view_document',     'document',   null,
    '37.16.122.71', 'Mozilla/5.0 (Macintosh)', now() - interval '4 days' + interval '3 minutes'),

  -- Reem (NEOM) — most recent
  ('11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000005',
    '11aa1111-0000-0000-0000-000000000009',
    'login',             null, null,
    '188.55.200.5', 'Mozilla/5.0 (Macintosh)', now() - interval '2 days');
