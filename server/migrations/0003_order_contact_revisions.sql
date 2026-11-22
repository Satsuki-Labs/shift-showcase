ALTER TABLE data_version ADD COLUMN staff_order_revision INTEGER NOT NULL DEFAULT 1 CHECK (staff_order_revision >= 1);
ALTER TABLE contact_names ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
