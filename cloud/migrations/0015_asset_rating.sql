-- How the owner judged a saved result: 'down', 'good' or 'great'
-- (lib/results/rating.ts). NULL is unrated, which every existing asset is.
-- The library filters on it and on the request's modelId, so a person can find
-- the model that worked for a prompt without remembering it.
-- Additive, so it is safe to apply before the Worker that writes it deploys.
ALTER TABLE account_assets ADD COLUMN rating TEXT CHECK (rating IN ('down','good','great'));
