-- Per-user policy for how much of their calendar teammates may see.
--
-- Absence of a row is the default: every teammate sees full event details.
-- 'busy_only' shares when the user is busy but withholds titles, guests,
-- locations, and other details; 'none' hides the calendar from teammates
-- entirely, including the team out-of-office overlay.
--
-- Cascades with the user row, the same cleanup story as team membership.
CREATE TABLE calendar_team_sharing (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    sharing text NOT NULL CHECK (sharing IN ('all', 'busy_only', 'none')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
