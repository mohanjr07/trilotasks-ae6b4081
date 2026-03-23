
-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text CHECK (role IN ('super_admin','admin','employee')) DEFAULT 'employee',
  department text,
  position text,
  avatar_url text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

-- Create tasks table
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.profiles(id) NOT NULL,
  assigned_by uuid REFERENCES public.profiles(id) NOT NULL,
  priority text CHECK (priority IN ('low','medium','high')) DEFAULT 'medium',
  status text CHECK (status IN ('todo','in_progress','on_hold','completed')) DEFAULT 'todo',
  progress integer CHECK (progress >= 0 AND progress <= 100) DEFAULT 0,
  deadline date,
  category text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create task_comments table
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create task_attachments table
CREATE TABLE public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  created_at timestamptz DEFAULT now()
);

-- Create leave_requests table
CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.profiles(id) NOT NULL,
  type text CHECK (type IN ('leave','permission')) NOT NULL,
  leave_category text CHECK (leave_category IN ('annual','sick','emergency','unpaid','other')),
  start_date date NOT NULL,
  end_date date,
  start_time time,
  end_time time,
  reason text NOT NULL,
  status text CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz DEFAULT now()
);

-- Create notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  type text CHECK (type IN ('task','leave','system')),
  reference_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Helper function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid
$$;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = uid AND role IN ('admin', 'super_admin')
  )
$$;

-- Profiles policies
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can insert profiles" ON public.profiles FOR INSERT WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE USING (public.is_admin(auth.uid()));
CREATE POLICY "Super admins can delete profiles" ON public.profiles FOR DELETE USING (public.get_user_role(auth.uid()) = 'super_admin');

-- Tasks policies
CREATE POLICY "Admins can do all on tasks" ON public.tasks FOR ALL USING (public.is_admin(auth.uid()));
CREATE POLICY "Employees can read own tasks" ON public.tasks FOR SELECT USING (auth.uid() = assigned_to);
CREATE POLICY "Employees can update own tasks" ON public.tasks FOR UPDATE USING (auth.uid() = assigned_to);

-- Task comments policies
CREATE POLICY "Users can read comments on visible tasks" ON public.task_comments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_comments.task_id AND (tasks.assigned_to = auth.uid() OR public.is_admin(auth.uid())))
);
CREATE POLICY "Users can insert comments on visible tasks" ON public.task_comments FOR INSERT WITH CHECK (
  auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_comments.task_id AND (tasks.assigned_to = auth.uid() OR public.is_admin(auth.uid())))
);

-- Task attachments policies
CREATE POLICY "Users can read attachments on visible tasks" ON public.task_attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_attachments.task_id AND (tasks.assigned_to = auth.uid() OR public.is_admin(auth.uid())))
);
CREATE POLICY "Users can insert attachments on visible tasks" ON public.task_attachments FOR INSERT WITH CHECK (
  auth.uid() = uploaded_by AND EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_attachments.task_id AND (tasks.assigned_to = auth.uid() OR public.is_admin(auth.uid())))
);

-- Leave requests policies
CREATE POLICY "Admins can do all on leave_requests" ON public.leave_requests FOR ALL USING (public.is_admin(auth.uid()));
CREATE POLICY "Employees can read own leave_requests" ON public.leave_requests FOR SELECT USING (auth.uid() = employee_id);
CREATE POLICY "Employees can insert own leave_requests" ON public.leave_requests FOR INSERT WITH CHECK (auth.uid() = employee_id);
CREATE POLICY "Employees can update own pending leave_requests" ON public.leave_requests FOR UPDATE USING (auth.uid() = employee_id AND status = 'pending');

-- Notifications policies
CREATE POLICY "Users can read own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger for tasks updated_at
CREATE TRIGGER update_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Indexes
CREATE INDEX idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_deadline ON public.tasks(deadline);
CREATE INDEX idx_leave_requests_employee ON public.leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON public.leave_requests(status);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(is_read);
CREATE INDEX idx_task_comments_task ON public.task_comments(task_id);
