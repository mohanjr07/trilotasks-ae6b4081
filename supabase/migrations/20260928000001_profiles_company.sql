-- Company for each Task Flow user (Users → Add / Edit User)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_company_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_check
  CHECK (company IS NULL OR company IN ('Trilo', 'Magic Aisles'));
