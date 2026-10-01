-- Consent for Relaxed filter. Nullable: existing accounts have not confirmed,
-- and a job that arrives with moderation=relaxed and no row is run as Standard.
-- policy_version is compared to the app's RELAXED_POLICY_VERSION so a bumped
-- policy asks again instead of honoring an old confirmation forever.
ALTER TABLE account_users ADD COLUMN relaxed_consent_at INTEGER;
ALTER TABLE account_users ADD COLUMN relaxed_policy_version INTEGER;
