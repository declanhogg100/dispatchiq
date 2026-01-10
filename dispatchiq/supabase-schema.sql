-- SignalOne Database Schema for Supabase

-- Enable realtime for the public schema
-- Run this in Supabase SQL Editor

-- Table for storing call sessions
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT UNIQUE NOT NULL,
  stream_sid TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'ended'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for storing transcript messages
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL,
  sender TEXT NOT NULL, -- 'caller' or 'dispatcher'
  text TEXT NOT NULL,
  is_final BOOLEAN DEFAULT true,
  is_partial BOOLEAN DEFAULT false,
  confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_call_sid (call_sid),
  INDEX idx_created_at (created_at)
);

-- Table for storing incident details (optional, for future use)
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL UNIQUE,
  location TEXT,
  type TEXT,
  injuries TEXT,
  threat_level TEXT,
  people_count TEXT,
  caller_role TEXT,
  urgency TEXT DEFAULT 'Low',
  next_question TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (for demo purposes)
-- In production, you'd want more restrictive policies

CREATE POLICY "Allow all operations on calls" ON calls
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on transcripts" ON transcripts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on incidents" ON incidents
  FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for transcripts table
-- This must be done in Supabase Dashboard > Database > Replication
-- Or run: ALTER PUBLICATION supabase_realtime ADD TABLE transcripts;

-- To enable realtime, go to:
-- Supabase Dashboard → Database → Replication → Enable for 'transcripts' table

