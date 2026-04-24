-- Run this in your Supabase SQL Editor to add the missing columns
-- Since the table is already created, this will safely add them!

ALTER TABLE public.nexus_sessions
ADD COLUMN IF NOT EXISTS user_name TEXT,
ADD COLUMN IF NOT EXISTS user_email TEXT,
ADD COLUMN IF NOT EXISTS drive_link TEXT,
ADD COLUMN IF NOT EXISTS document_path TEXT,
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Also fixing telegram_user to gracefully map to user_name (optional)
