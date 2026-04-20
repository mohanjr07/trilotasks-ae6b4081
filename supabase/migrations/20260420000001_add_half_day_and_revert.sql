-- ============================================================
-- Half-day casual leave + Leave revert support
-- ============================================================

-- 1. Add is_half_day flag (0.5 day counts toward monthly quota)
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS is_half_day boolean NOT NULL DEFAULT false;

-- 2. Add half_day_period to record which half of the day (AM / PM)
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS half_day_period text
  CHECK (half_day_period IS NULL OR half_day_period IN ('AM', 'PM'));

-- 3. Add reverted_at + reverted_by to capture when an approved leave
--    is reverted/cancelled (so it no longer counts as leave).
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reverted_by uuid REFERENCES public.profiles(id);

-- 4. Helpful indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_half_day
  ON public.leave_requests(is_half_day);

CREATE INDEX IF NOT EXISTS idx_leave_requests_reverted_at
  ON public.leave_requests(reverted_at);
