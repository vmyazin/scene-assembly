-- Why a job stopped, separately from `error_code`.
--
-- `error_code` is the coarse bucket the state machine branches on (save_failed,
-- submission_ambiguous, tracking_stopped, ...). It answers "which arm of the
-- runner gave up", which is the wrong question for a reader: three unrelated
-- causes arrived at the account page as one sentence about needing "another
-- attempt", and a resume that could never work was offered for all of them.
--
-- `failure_reason` holds a fixed vocabulary from `src/failure.ts` and is what
-- decides the sentence on the row and whether Resume is offered at all.
-- `failure_detail` holds a sanitized provider message and is set only for
-- `provider_rejected` -- it is the one column vendor text can reach, and it
-- passes through `sanitizeProviderMessage` first, because a raw vendor body can
-- carry a key.
--
-- Both nullable: jobs that already stopped keep NULL and fall back to the old
-- generic copy, since their reason was never recorded and cannot be recovered.
-- Additive, so it is safe to apply before the Worker that writes it deploys.
ALTER TABLE account_jobs ADD COLUMN failure_reason TEXT;
ALTER TABLE account_jobs ADD COLUMN failure_detail TEXT;
