-- QueueSmart schema, tables in foreign-key order

CREATE SEQUENCE IF NOT EXISTS user_credentials_id_seq;
CREATE TABLE IF NOT EXISTS user_credentials (
  id int PRIMARY KEY DEFAULT nextval('user_credentials_id_seq'),
  email varchar(254) NOT NULL UNIQUE,
  password_hash varchar(100) NOT NULL,
  role varchar(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id int PRIMARY KEY REFERENCES user_credentials(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL UNIQUE CONSTRAINT user_profiles_email_fkey REFERENCES user_credentials(email) ON UPDATE CASCADE,
  full_name varchar(100) NOT NULL,
  phone varchar(20) NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE SEQUENCE IF NOT EXISTS services_id_seq;
CREATE TABLE IF NOT EXISTS services (
  id int PRIMARY KEY DEFAULT nextval('services_id_seq'),
  name varchar(100) NOT NULL UNIQUE,
  description varchar(500) NOT NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  priority varchar(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  created_at timestamptz DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS queues_id_seq;
CREATE TABLE IF NOT EXISTS queues (
  id int PRIMARY KEY DEFAULT nextval('queues_id_seq'),
  service_id int NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  status varchar(6) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS queue_entries_id_seq;
CREATE TABLE IF NOT EXISTS queue_entries (
  id int PRIMARY KEY DEFAULT nextval('queue_entries_id_seq'),
  queue_id int NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position > 0),
  priority varchar(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  join_time timestamptz NOT NULL DEFAULT now(),
  status varchar(8) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'served', 'canceled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_one_waiting_per_user
  ON queue_entries (user_id) WHERE status = 'waiting';

CREATE SEQUENCE IF NOT EXISTS notifications_id_seq;
CREATE TABLE IF NOT EXISTS notifications (
  id int PRIMARY KEY DEFAULT nextval('notifications_id_seq'),
  user_id int NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
  audience varchar(5) NOT NULL CHECK (audience IN ('user', 'admin')),
  type varchar(20) NOT NULL CHECK (type IN ('signup', 'queue_update', 'status_change')),
  title varchar(100) NOT NULL,
  message varchar(300) NOT NULL,
  status varchar(6) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (audience <> 'user' OR user_id IS NOT NULL)
);

CREATE SEQUENCE IF NOT EXISTS queue_history_id_seq;
CREATE TABLE IF NOT EXISTS queue_history (
  id int PRIMARY KEY DEFAULT nextval('queue_history_id_seq'),
  user_id int NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
  service_id int NULL REFERENCES services(id) ON DELETE SET NULL,
  service_name varchar(100) NOT NULL,
  outcome varchar(20) NOT NULL,
  entry_id int NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);