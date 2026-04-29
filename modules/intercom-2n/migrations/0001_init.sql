CREATE TABLE IF NOT EXISTS mod_intercom_2n_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL,
  serial varchar(100) NOT NULL,
  display_name varchar(255) NOT NULL,
  paired_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (building_id, serial)
);
