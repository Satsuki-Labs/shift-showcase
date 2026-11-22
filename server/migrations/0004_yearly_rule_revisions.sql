ALTER TABLE peaks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE annual_closures ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE opening_rules ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
