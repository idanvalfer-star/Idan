-- Row Level Security policies for family-scoped access

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can view their own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Families table policies
CREATE POLICY "Users can view their family"
  ON families FOR SELECT
  USING (id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family creator can update family settings"
  ON families FOR UPDATE
  USING (created_by = auth.uid());

-- List items policies
CREATE POLICY "Users can view their family's shopping list"
  ON list_items FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert items to their family's list"
  ON list_items FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update items in their family's list"
  ON list_items FOR UPDATE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete items from their family's list"
  ON list_items FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

-- Home inventory policies
CREATE POLICY "Users can view their family's inventory"
  ON home_inventory FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert items to their family's inventory"
  ON home_inventory FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update their family's inventory"
  ON home_inventory FOR UPDATE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete from their family's inventory"
  ON home_inventory FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

-- Videos policies
CREATE POLICY "Users can view their family's videos"
  ON videos FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert videos to their family"
  ON videos FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete their family's videos"
  ON videos FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

-- Recipes policies
CREATE POLICY "Users can view their family's recipes"
  ON recipes FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert recipes to their family"
  ON recipes FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update their family's recipes"
  ON recipes FOR UPDATE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete their family's recipes"
  ON recipes FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );
