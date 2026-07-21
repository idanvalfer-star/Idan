-- Create tables for Cartly family sharing

-- Families table
CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code TEXT UNIQUE NOT NULL,
  family_name TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shopping list items
CREATE TABLE list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  category TEXT,
  emoji TEXT,
  checked BOOLEAN DEFAULT FALSE,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),

  INDEX idx_family_id (family_id),
  INDEX idx_checked (checked)
);

-- Home inventory
CREATE TABLE home_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INT DEFAULT 1,
  unit TEXT,
  expiry DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),

  INDEX idx_family_id (family_id),
  INDEX idx_expiry (expiry)
);

-- Saved videos
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  platform TEXT,
  title TEXT,
  description TEXT,
  thumb TEXT,
  ingredients JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  INDEX idx_family_id (family_id)
);

-- Recipes
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  time TEXT,
  ingredients JSONB,
  steps TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  INDEX idx_family_id (family_id)
);

-- Enable realtime for list_items and home_inventory
ALTER TABLE list_items REPLICA IDENTITY FULL;
ALTER TABLE home_inventory REPLICA IDENTITY FULL;

-- Create indexes for better performance
CREATE INDEX idx_users_family ON users(family_id);
CREATE INDEX idx_families_created_by ON families(created_by);
