-- Existing tables are kept. Fails rather than changing invalid existing data.
CREATE UNIQUE INDEX IF NOT EXISTS user_credentials_email_ci ON user_credentials (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_ci ON user_profiles (lower(email));
ALTER TABLE user_credentials ADD CONSTRAINT user_credentials_id_email_key UNIQUE (id, email);
-- The original independent FKs allowed a profile id and email from different accounts.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_fkey;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_credentials_fkey
  FOREIGN KEY (user_id, email) REFERENCES user_credentials(id, email) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_full_name_check
  CHECK (length(trim(full_name)) BETWEEN 1 AND 100);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_email_check
  CHECK (length(trim(email)) > 0 AND email = trim(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_phone_check
  CHECK (phone IS NULL OR (phone ~ '^\+?[0-9 ().-]+$' AND length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 7 AND 15));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_preferences_check
  CHECK (preferences IN ('{}'::jsonb, '{"contactMethod":"email"}'::jsonb, '{"contactMethod":"phone"}'::jsonb));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_contact_phone_check
  CHECK (preferences <> '{"contactMethod":"phone"}'::jsonb OR phone IS NOT NULL);
